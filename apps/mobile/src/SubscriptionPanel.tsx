import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { usePlatform } from './usePlatform';

type Props = { platform: ReturnType<typeof usePlatform> };

export function SubscriptionPanel({ platform }: Props) {
  const [showImport, setShowImport] = useState(false);
  const [content, setContent] = useState('');
  const [visibleCount, setVisibleCount] = useState(20);
  const { nodes, openedId, selectedId, busy } = platform;
  const active = platform.tunnel.state !== 'disconnected';
  if (!openedId) return null;
  return (
    <View style={styles.panel}>
      <Text style={styles.body}>
        {nodes
          ? `${nodes.nodes.length} 个节点${
              nodes.skipped ? ` · 跳过 ${nodes.skipped} 项` : ''
            }`
          : '更新以获取节点'}
      </Text>
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        style={styles.button}
        onPress={() => {
          platform.updateSubscription(openedId);
        }}
      >
        <Text style={styles.link}>{busy ? '更新中…' : '更新节点'}</Text>
      </Pressable>
      {nodes?.nodes.slice(0, visibleCount).map(node => (
        <Pressable
          key={node.id}
          accessibilityRole="radio"
          accessibilityState={{
            checked: node.id === selectedId,
            disabled: busy || active || !!node.blockedReason,
          }}
          disabled={busy || active || !!node.blockedReason}
          style={[styles.node, node.id === selectedId && styles.selected]}
          onPress={() => platform.selectNode(node.id)}
        >
          <Text style={styles.nodeName}>
            {node.id === selectedId ? '● ' : '○ '}
            {node.name}
          </Text>
          <Text style={styles.body}>
            {node.type}
            {node.blockedReason ? ' · 暂不可用' : ''}
          </Text>
        </Pressable>
      ))}
      {!!nodes && nodes.nodes.length > visibleCount && (
        <Pressable
          accessibilityRole="button"
          style={styles.button}
          onPress={() => setVisibleCount(n => n + 20)}
        >
          <Text style={styles.link}>显示更多节点</Text>
        </Pressable>
      )}
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        style={styles.button}
        onPress={() => {
          setShowImport(!showImport);
          setContent('');
        }}
      >
        <Text style={styles.link}>{showImport ? '取消粘贴' : '粘贴配置'}</Text>
      </Pressable>
      {showImport && (
        <>
          <Text style={styles.body}>粘贴 YAML、JSON 或节点链接</Text>
          <TextInput
            accessibilityLabel="订阅配置内容"
            multiline
            value={content}
            onChangeText={setContent}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={524288}
            editable={!busy}
            placeholder="在此粘贴配置"
            placeholderTextColor="#788a9d"
            style={styles.input}
          />
          <Pressable
            accessibilityRole="button"
            disabled={busy || !content.trim()}
            style={styles.button}
            onPress={async () => {
              if (await platform.updateSubscription(openedId, content)) {
                setContent('');
                setShowImport(false);
              }
            }}
          >
            <Text style={styles.link}>导入</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: 14, padding: 18, backgroundColor: '#0d1927', borderRadius: 14 },
  title: { color: '#f0f5fa', fontSize: 17, fontWeight: '600' },
  body: { color: '#a7b6c8', fontSize: 13, lineHeight: 21 },
  node: {
    padding: 14,
    borderWidth: 1,
    borderColor: '#314359',
    borderRadius: 10,
    gap: 6,
  },
  selected: { borderColor: '#7ce3c2', backgroundColor: '#173c38' },
  nodeName: { color: '#f0f5fa', fontSize: 15 },
  button: {
    minHeight: 44,
    padding: 12,
    borderWidth: 1,
    borderColor: '#314359',
    borderRadius: 10,
    alignItems: 'center',
  },
  link: { color: '#7ce3c2', fontSize: 14 },
  input: {
    minHeight: 140,
    maxHeight: 220,
    borderWidth: 1,
    borderColor: '#314359',
    borderRadius: 10,
    padding: 12,
    color: '#f0f5fa',
    fontSize: 13,
    textAlignVertical: 'top',
  },
});
