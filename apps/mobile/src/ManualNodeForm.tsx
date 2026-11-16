import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { usePlatform } from './usePlatform';

export function ManualNodeForm({
  platform,
}: {
  platform: ReturnType<typeof usePlatform>;
}) {
  const [server, setServer] = useState('');
  const [port, setPort] = useState('443');
  const [password, setPassword] = useState('');
  const active = platform.tunnel.state !== 'disconnected';
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>手动节点</Text>
      <Text style={styles.body}>Shadowsocks · AES-128-GCM</Text>
      <Text style={styles.label}>服务器域名或 IP</Text>
      <TextInput
        accessibilityLabel="服务器域名或 IP"
        style={styles.input}
        value={server}
        onChangeText={setServer}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!active && !platform.busy}
        placeholder="例如 proxy.example.com"
        placeholderTextColor="#718497"
      />
      <Text style={styles.label}>端口</Text>
      <TextInput
        accessibilityLabel="节点端口"
        style={styles.input}
        value={port}
        onChangeText={setPort}
        keyboardType="number-pad"
        editable={!active && !platform.busy}
        maxLength={5}
      />
      <Text style={styles.label}>节点密码</Text>
      <TextInput
        accessibilityLabel="节点密码"
        style={styles.input}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        editable={!active && !platform.busy}
        maxLength={4096}
      />
      <Pressable
        accessibilityRole="button"
        disabled={platform.busy || active || !server || !port || !password}
        style={styles.secondaryButton}
        onPress={async () => {
          if (await platform.connect(server, port, password)) setPassword('');
        }}
      >
        <Text style={styles.link}>
          {platform.busy ? '正在处理…' : '连接此节点'}
        </Text>
      </Pressable>
    </View>
  );
}
const styles = StyleSheet.create({
  card: { backgroundColor: '#152334', padding: 20, borderRadius: 18, gap: 12 },
  cardTitle: { color: '#f0f5fa', fontSize: 17, fontWeight: '600' },
  body: { color: '#a7b6c8', fontSize: 13, lineHeight: 20 },
  label: { color: '#a7b6c8', fontSize: 13 },
  input: {
    minHeight: 48,
    backgroundColor: '#0d1927',
    color: '#f0f5fa',
    borderRadius: 12,
    paddingHorizontal: 14,
    fontSize: 15,
  },
  secondaryButton: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#314359',
    alignItems: 'center',
    justifyContent: 'center',
  },
  link: { color: '#7ce3c2', fontSize: 14 },
});
