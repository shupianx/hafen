import { useCallback, useRef, useState, type ComponentRef } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { AddSubscriptionSheet } from './src/AddSubscriptionSheet';
import { ManualNodeForm } from './src/ManualNodeForm';
import { SubscriptionPanel } from './src/SubscriptionPanel';
import { usePlatform } from './src/usePlatform';
import { safePlatformError, type TunnelDiagnostics } from '@hafen/domain';

export default function App() {
  return (
    <SafeAreaProvider>
      <Home />
    </SafeAreaProvider>
  );
}

function Home() {
  const [adding, setAdding] = useState(false);
  const [starting, setStarting] = useState(false);
  const [checking, setChecking] = useState(false);
  const compact = useWindowDimensions().height < 600;
  const [manual, setManual] = useState(false);
  const [collapsedId, setCollapsedId] = useState<string | null>(null);
  const list = useRef<ComponentRef<typeof ScrollView>>(null);
  const platform = usePlatform();
  const active = platform.tunnel.state !== 'disconnected';
  const switchOn = platform.tunnel.state === 'connecting' || platform.tunnel.state === 'connected';
  const transitioning =
    starting ||
    platform.tunnel.state === 'connecting' ||
    platform.tunnel.state === 'disconnecting';
  const stateLabel = {
    disconnected: '未连接',
    connecting: '连接中…',
    connected: '隧道已连接',
    disconnecting: '断开中…',
  }[platform.tunnel.state];
  const selected = platform.nodes?.nodes.find(
    node => node.id === platform.selectedId,
  );
  const disabled = platform.busy || !platform.environment;
  const switchDisabled =
    platform.tunnel.state === 'disconnecting' ||
    (!active && (disabled || !platform.environment?.vpnAvailable));
  const feedback = platform.error || platform.tunnelError;
  const clearFeedback = platform.clearFeedback;
  const closeSheet = useCallback(() => {
    setAdding(false);
    clearFeedback();
  }, [clearFeedback]);

  function openSheet() {
    platform.clearFeedback();
    setAdding(true);
  }
  async function toggleConnection() {
    if (active) {
      platform.disconnect();
    } else if (selected) {
      setStarting(true);
      try {
        await platform.connectSelected();
      } finally {
        setStarting(false);
      }
    } else if (!platform.subscriptions.length) {
      openSheet();
    } else {
      if (!platform.openedId)
        platform.openSubscription(platform.subscriptions[0].id);
      setCollapsedId(null);
      list.current?.scrollTo({ y: 0, animated: true });
    }
  }
  function confirmDelete(id: string, title: string) {
    Alert.alert('删除订阅', `删除“${title}”及其节点？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          platform.remove(id);
        },
      },
    ]);
  }

  async function checkConnection() {
    if (checking) return;
    setChecking(true);
    try {
      const report = await platform.diagnose();
      const labels: Record<TunnelDiagnostics['endpointDNS'], string> = {
        IP: 'IP 地址', SKIPPED: '跳过', NOT_RUN: '未执行',
        NONE: '通过', DNS: '域名解析失败', TLS: '证书校验失败', TIMEOUT: '超时',
        CONNECT: '连接失败', HTTP: '响应异常', CLOSED: '已断开',
        BUSY: '检测中', UNAVAILABLE: '无响应',
        PROTECTION: '出口网卡绑定失败', REALITY: 'REALITY 校验失败',
        REFUSED: '连接被拒绝', RESET: '连接被重置', UNREACHABLE: '无法到达服务器',
        EOF: '连接被关闭', TLS_HANDSHAKE: 'TLS 握手失败',
      };
      Alert.alert('连接检测', [
        `节点 HTTPS：${labels[report.proxyError]}`,
        `系统 HTTPS：${labels[report.systemError]}`,
        `内核网络：${report.networkPaused === true ? '暂停' : report.networkAvailable === true && report.networkPaused === false ? '可用' : '未知'}`,
        `节点解析：${labels[report.endpointDNS]}`,
        `节点 TCP：${labels[report.endpointTCP]}`,
        `代理连接：${labels[report.proxyHandshake]}`,
        `目标 TLS：${labels[report.targetTLS]}`,
        ...(report.errorTrace ? [`错误标识：${report.errorTrace}`] : []),
        `全流量路由：${report.includeAllNetworks ? '已开启' : '未开启'}`,
        `检测期间数据包：发送 ${report.packetsInDelta ?? '—'} / 返回 ${report.packetsOutDelta ?? '—'}`,
        `累计数据包：发送 ${report.packetsIn ?? '—'} / 返回 ${report.packetsOut ?? '—'}`,
        '\n检测目标为 Cloudflare；结果不代表所有网站可用，数据包数量也不能单独证明出口已改变。',
      ].join('\n'));
    } catch (reason) {
      Alert.alert('连接检测', safePlatformError(reason).message);
    } finally {
      setChecking(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar barStyle="light-content" />
      <View style={styles.header}>
        <Pressable
          testID="add-subscription"
          accessibilityRole="button"
          accessibilityLabel="添加订阅"
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={openSheet}
          style={({ pressed }) => [
            styles.iconButton,
            pressed && styles.pressed,
            disabled && styles.dimmed,
          ]}
        >
          <View style={styles.plusHorizontal} />
          <View style={styles.plusVertical} />
        </Pressable>
        <Text style={styles.brand}>HAFEN</Text>
        <View style={styles.headerSpacer} />
      </View>
      <View style={[styles.connection, compact && styles.connectionCompact]}>
        <View style={styles.switchContainer}>
          <Switch
            testID="connection-switch"
            accessibilityLabel="VPN 连接"
            accessibilityHint={
              active
                ? '断开连接'
                : selected
                ? '连接所选节点'
                : '添加订阅并选择节点'
            }
            accessibilityState={{
              checked: switchOn,
              disabled: switchDisabled,
              busy: transitioning,
            }}
            value={switchOn}
            disabled={switchDisabled}
            onValueChange={toggleConnection}
            trackColor={{ false: '#314359', true: '#7ce3c2' }}
            thumbColor="#f0f5fa"
            ios_backgroundColor="#314359"
            style={[styles.connectionSwitch, switchDisabled && styles.dimmed]}
          />
        </View>
        <View style={styles.stateRow}>
          {transitioning && <ActivityIndicator size="small" color="#7ce3c2" />}
          <Text accessibilityLiveRegion="polite" style={styles.state}>
            {starting ? '连接中…' : stateLabel}
          </Text>
        </View>
        <Text numberOfLines={1} style={styles.nodeHint}>
          {active
            ? platform.connectionName || 'VPN'
            : !platform.environment
            ? '加载中…'
            : !platform.environment.vpnAvailable
            ? '此设备暂不支持 VPN'
            : selected?.name ||
              (platform.subscriptions.length
                ? '选择节点后连接'
                : '添加订阅以开始')}
        </Text>
        {platform.environment?.platform === 'ios' && platform.tunnel.state === 'connected' && (
          <Pressable accessibilityRole="button" disabled={checking} onPress={checkConnection} style={styles.smallButton}>
            <Text style={styles.muted}>{checking ? '检测中…' : '检查连接'}</Text>
          </Pressable>
        )}
      </View>
      {!!feedback && !adding && (
        <Text accessibilityLiveRegion="polite" style={styles.error}>
          {feedback}
        </Text>
      )}
      <ScrollView
        ref={list}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        <View style={styles.sectionHeader}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>
            订阅
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="刷新订阅列表"
            disabled={platform.busy}
            onPress={() => {
              platform.refresh();
            }}
            style={styles.smallButton}
          >
            <Text style={styles.muted}>
              {platform.busy ? '处理中…' : '刷新'}
            </Text>
          </Pressable>
        </View>
        {!platform.subscriptions.length && (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>
              {platform.environment ? '暂无订阅' : '正在加载'}
            </Text>
            <Text style={styles.muted}>点击左上角 + 添加</Text>
          </View>
        )}
        {platform.subscriptions.map(subscription => (
          <View key={subscription.id} style={styles.subscriptionCard}>
            <View style={styles.subscriptionRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`查看订阅 ${subscription.name}`}
                accessibilityState={{
                  expanded:
                    platform.openedId === subscription.id &&
                    collapsedId !== subscription.id,
                  disabled,
                }}
                disabled={disabled}
                style={styles.subscriptionInfo}
                onPress={() => {
                  if (platform.openedId === subscription.id) {
                    setCollapsedId(current =>
                      current === subscription.id ? null : subscription.id,
                    );
                  } else {
                    setCollapsedId(null);
                    platform.openSubscription(subscription.id);
                  }
                }}
              >
                <View style={styles.subscriptionHeading}>
                  <Text numberOfLines={1} style={styles.subscriptionName}>
                    {subscription.name}
                  </Text>
                  <Text style={styles.chevron}>
                    {platform.openedId === subscription.id &&
                    collapsedId !== subscription.id
                      ? '−'
                      : '›'}
                  </Text>
                </View>
                <Text numberOfLines={1} style={styles.muted}>
                  {subscription.host}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`删除订阅 ${subscription.name}`}
                disabled={disabled}
                style={styles.smallButton}
                onPress={() =>
                  confirmDelete(subscription.id, subscription.name)
                }
              >
                <Text style={styles.deleteText}>删除</Text>
              </Pressable>
            </View>
            {platform.openedId === subscription.id &&
              collapsedId !== subscription.id && (
                <SubscriptionPanel key={subscription.id} platform={platform} />
              )}
          </View>
        ))}
        {platform.environment?.vpnAvailable && (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: manual }}
              onPress={() => setManual(!manual)}
              style={styles.manualToggle}
            >
              <Text style={styles.muted}>
                {manual ? '收起手动节点' : '手动节点'}
              </Text>
            </Pressable>
            {manual && <ManualNodeForm platform={platform} />}
          </>
        )}
      </ScrollView>
      <AddSubscriptionSheet
        visible={adding}
        busy={platform.busy}
        error={platform.error}
        onClose={closeSheet}
        onSave={platform.save}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0b1420' },
  header: {
    height: 56,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brand: {
    color: '#dce7ef',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 4,
  },
  headerSpacer: { width: 44 },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plusHorizontal: {
    width: 22,
    height: 2,
    borderRadius: 1,
    backgroundColor: '#7ce3c2',
  },
  plusVertical: {
    position: 'absolute',
    width: 2,
    height: 22,
    borderRadius: 1,
    backgroundColor: '#7ce3c2',
  },
  connection: {
    alignItems: 'center',
    paddingTop: 18,
    paddingBottom: 24,
    paddingHorizontal: 24,
    gap: 10,
  },
  connectionCompact: { paddingTop: 0, paddingBottom: 8, gap: 6 },
  switchContainer: {
    width: 84,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  connectionSwitch: { transform: [{ scale: 1.4 }] },
  stateRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  state: { color: '#f0f5fa', fontSize: 22, fontWeight: '600' },
  nodeHint: { color: '#93a5b9', fontSize: 13, maxWidth: '100%' },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 24,
    gap: 12,
    width: '100%',
    maxWidth: 600,
    alignSelf: 'center',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: { color: '#f0f5fa', fontSize: 17, fontWeight: '600' },
  muted: { color: '#93a5b9', fontSize: 13, lineHeight: 20 },
  smallButton: {
    minHeight: 44,
    paddingHorizontal: 12,
    justifyContent: 'center',
  },
  empty: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 44,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#28384a',
    borderRadius: 20,
  },
  emptyTitle: { color: '#c4d1e0', fontSize: 15 },
  subscriptionCard: {
    backgroundColor: '#152334',
    borderRadius: 18,
    overflow: 'hidden',
  },
  subscriptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  subscriptionInfo: { flex: 1, padding: 16, gap: 5, minHeight: 76 },
  subscriptionHeading: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  subscriptionName: {
    color: '#f0f5fa',
    fontSize: 16,
    fontWeight: '600',
    flexShrink: 1,
  },
  chevron: { color: '#7ce3c2', fontSize: 20 },
  deleteText: { color: '#bb9292', fontSize: 12 },
  manualToggle: {
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
    marginTop: 8,
  },
  error: {
    color: '#ffb4a9',
    fontSize: 13,
    lineHeight: 20,
    paddingHorizontal: 24,
    paddingBottom: 12,
  },
  pressed: { opacity: 0.65 },
  dimmed: { opacity: 0.4 },
});
