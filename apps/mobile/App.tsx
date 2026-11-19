import { useCallback, useState } from 'react';
import { ProgressiveBlurView } from '@sbaiahmed1/react-native-blur';
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import {
  SafeAreaProvider,
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import HafenHomeScrollEdges from './specs/HafenHomeScrollEdgesNativeComponent';
import { AddSubscriptionSheet } from './src/AddSubscriptionSheet';
import { ManualNodeForm } from './src/ManualNodeForm';
import { Glass, color } from './src/Glass';
import { WebsiteLatency } from './src/WebsiteLatency';
import { SubscriptionPanel } from './src/SubscriptionPanel';
import { usePlatform } from './src/usePlatform';
import { safePlatformError, type TunnelDiagnostics } from '@hafen/domain';

const homeTopSpacing = 12;
const androidBlurFalloff = 20;
const showManualNodeEntry = false;

export default function App() {
  return (
    <SafeAreaProvider>
      <Home />
    </SafeAreaProvider>
  );
}

function Home() {
  const insets = useSafeAreaInsets();
  const ios = Platform.OS === 'ios';
  const systemScrollEdges = ios && parseInt(String(Platform.Version), 10) >= 26;
  const androidTopBarHeight =
    !ios && insets.top > 0
      ? insets.top + homeTopSpacing + androidBlurFalloff
      : 0;
  const [adding, setAdding] = useState(false);
  const [starting, setStarting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [manual, setManual] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const closeDetails = useCallback(() => setDetailId(null), []);
  const platform = usePlatform();
  const active = platform.switching || platform.tunnel.state !== 'disconnected';
  const switchOn =
    platform.switching ||
    platform.tunnel.state === 'connecting' ||
    platform.tunnel.state === 'connected';
  const transitioning =
    starting ||
    platform.switching ||
    platform.tunnel.state === 'connecting' ||
    platform.tunnel.state === 'disconnecting';
  const stateLabel = {
    disconnected: '未连接',
    connecting: '连接中…',
    connected: '隧道已连接',
    disconnecting: '断开中…',
  }[platform.tunnel.state];
  const selected = platform.selection;
  const disabled = platform.busy || !platform.environment;
  const switchDisabled =
    (!platform.switching && platform.tunnel.state === 'disconnecting') ||
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
      openDetails(platform.subscriptions[0].id);
    }
  }
  function openDetails(id: string) {
    platform.clearFeedback();
    setDetailId(id);
    platform.openSubscription(id);
  }
  function confirmDelete(id: string, title: string) {
    Alert.alert('删除订阅', `删除“${title}”及其节点？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          if (await platform.remove(id)) {
            setDetailId(null);
          }
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
        IP: 'IP 地址',
        SKIPPED: '跳过',
        NOT_RUN: '未执行',
        NONE: '通过',
        DNS: '域名解析失败',
        TLS: '证书校验失败',
        TIMEOUT: '超时',
        CONNECT: '连接失败',
        HTTP: '响应异常',
        CLOSED: '已断开',
        BUSY: '检测中',
        UNAVAILABLE: '无响应',
        PROTECTION: '出口网卡绑定失败',
        REALITY: 'REALITY 校验失败',
        REFUSED: '连接被拒绝',
        RESET: '连接被重置',
        UNREACHABLE: '无法到达服务器',
        EOF: '连接被关闭',
        TLS_HANDSHAKE: 'TLS 握手失败',
      };
      Alert.alert(
        '连接检测',
        [
          `节点 HTTPS：${labels[report.proxyError]}`,
          `系统 HTTPS：${labels[report.systemError]}`,
          `内核网络：${
            report.networkPaused === true
              ? '暂停'
              : report.networkAvailable === true &&
                report.networkPaused === false
              ? '可用'
              : '未知'
          }`,
          `节点解析：${labels[report.endpointDNS]}`,
          `节点 TCP：${labels[report.endpointTCP]}`,
          `代理连接：${labels[report.proxyHandshake]}`,
          `目标 TLS：${labels[report.targetTLS]}`,
          ...(report.errorTrace ? [`错误标识：${report.errorTrace}`] : []),
          `全流量路由：${report.includeAllNetworks ? '已开启' : '未开启'}`,
          `检测期间数据包：发送 ${report.packetsInDelta ?? '—'} / 返回 ${
            report.packetsOutDelta ?? '—'
          }`,
          `累计数据包：发送 ${report.packetsIn ?? '—'} / 返回 ${
            report.packetsOut ?? '—'
          }`,
          '\n检测目标为 Cloudflare；结果不代表所有网站可用，数据包数量也不能单独证明出口已改变。',
        ].join('\n'),
      );
    } catch (reason) {
      Alert.alert('连接检测', safePlatformError(reason).message);
    } finally {
      setChecking(false);
    }
  }

  const detail = platform.subscriptions.find(record => record.id === detailId);
  const nodeLabel = platform.switching
    ? selected?.name
    : active
    ? platform.connectionName ||
      (platform.tunnel.state === 'connected' ? '节点信息不可用' : 'VPN')
    : !platform.environment
    ? '加载中…'
    : !platform.environment.vpnAvailable
    ? '此设备暂不支持 VPN'
    : selected?.name ||
      (platform.subscriptions.length ? '选择节点后连接' : '添加订阅以开始');

  return (
    <View style={styles.background}>
      <SafeAreaView
        edges={
          ios && !systemScrollEdges
            ? ['top', 'left', 'right']
            : ['left', 'right']
        }
        style={styles.screen}
        accessibilityElementsHidden={adding}
        importantForAccessibility={adding ? 'no-hide-descendants' : 'auto'}
      >
        <StatusBar barStyle="dark-content" />
        <ScrollView
          contentContainerStyle={[
            styles.content,
            {
              paddingTop: androidTopBarHeight || homeTopSpacing,
              paddingBottom:
                (ios ? 28 : 0) + (systemScrollEdges ? 0 : insets.bottom),
            },
          ]}
          contentInsetAdjustmentBehavior={
            systemScrollEdges ? 'always' : 'never'
          }
          automaticallyAdjustContentInsets={false}
          automaticallyAdjustsScrollIndicatorInsets={false}
          scrollIndicatorInsets={{ top: insets.top, bottom: insets.bottom }}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
        >
          {systemScrollEdges && (
            <HafenHomeScrollEdges
              collapsable={false}
              pointerEvents="none"
              accessibilityElementsHidden
              style={styles.scrollEdgeConfiguration}
            />
          )}
          <Glass>
            <View style={styles.hero}>
              <Image
                source={require('./src/assets/tide.png')}
                resizeMode="stretch"
                accessible={false}
                style={styles.tide}
              />
              <View style={styles.connectionInfo}>
                <View style={styles.statusLine}>
                  {transitioning ? (
                    <ActivityIndicator size="small" color={color.white} />
                  ) : (
                    <View style={[styles.dot, switchOn && styles.online]} />
                  )}
                  <Text accessibilityLiveRegion="polite" style={styles.state}>
                    VPN{' '}
                    {platform.switching
                      ? '切换中…'
                      : starting
                      ? '连接中…'
                      : stateLabel}
                  </Text>
                </View>
                {!!nodeLabel && (
                  <Text numberOfLines={2} style={styles.hint}>
                    {nodeLabel}
                  </Text>
                )}
              </View>
              {platform.environment?.platform === 'ios' &&
                platform.tunnel.state === 'connected' &&
                !platform.switching && (
                  <Pressable
                    accessibilityRole="button"
                    disabled={checking}
                    onPress={checkConnection}
                    style={styles.diagnosticAction}
                  >
                    <Text style={styles.heroLink}>
                      {checking ? '检测中…' : '检查连接'}
                    </Text>
                  </Pressable>
                )}
              <Switch
                testID="connection-switch"
                style={styles.connectionSwitch}
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
                trackColor={{ false: '#666666', true: '#E6E6E6' }}
                thumbColor={switchOn ? color.ink : color.white}
                ios_backgroundColor="#666666"
              />
            </View>
          </Glass>
          {!!feedback && !adding && !detail && (
            <Text accessibilityLiveRegion="polite" style={styles.error}>
              {feedback}
            </Text>
          )}
          <View>
            <View style={styles.sectionHeader}>
              <Text accessibilityRole="header" style={styles.title}>
                订阅
              </Text>
              <Pressable
                testID="add-subscription"
                accessibilityRole="button"
                accessibilityLabel="添加订阅"
                disabled={disabled}
                onPress={openSheet}
                style={({ pressed }) => [styles.add, pressed && styles.pressed]}
              >
                <Text style={styles.plus}>＋</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="刷新订阅列表"
                disabled={platform.busy}
                style={styles.action}
                onPress={() => platform.refresh()}
              >
                <Text style={styles.link}>
                  {platform.busy ? '处理中…' : '刷新'}
                </Text>
              </Pressable>
            </View>
            <Glass>
              {platform.subscriptions.length ? (
                platform.subscriptions.map(record => (
                  <Pressable
                    key={record.id}
                    accessibilityRole="button"
                    accessibilityLabel={'查看订阅 ' + record.name}
                    disabled={disabled}
                    onPress={() => openDetails(record.id)}
                    style={({ pressed }) => [
                      styles.subscriptionRow,
                      pressed && styles.pressed,
                    ]}
                  >
                    <SubscriptionIcon />
                    <View style={styles.subscriptionText}>
                      <Text numberOfLines={1} style={styles.subscriptionName}>
                        {record.name}
                      </Text>
                      <Text numberOfLines={1} style={styles.meta}>
                        {record.host}
                      </Text>
                    </View>
                    <Text style={styles.chevron}>›</Text>
                  </Pressable>
                ))
              ) : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="添加第一个订阅"
                  disabled={disabled}
                  style={({ pressed }) => [
                    styles.subscriptionRow,
                    pressed && styles.pressed,
                  ]}
                  onPress={openSheet}
                >
                  <SubscriptionIcon />
                  <View style={styles.subscriptionText}>
                    <Text style={styles.subscriptionName}>
                      {platform.environment ? '添加订阅' : '正在加载'}
                    </Text>
                    <Text style={styles.meta}>通过订阅链接导入节点</Text>
                  </View>
                  <Text style={styles.chevron}>›</Text>
                </Pressable>
              )}
            </Glass>
          </View>
          <WebsiteLatency
            route={
              platform.tunnel.state +
              '/' +
              (platform.tunnel.connectionName || '') +
              '/' +
              (active ? selected?.nodeId || '' : '')
            }
            pending={transitioning}
          />
          {showManualNodeEntry && platform.environment?.vpnAvailable && (
            <View>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: manual }}
                style={styles.manual}
                onPress={() => setManual(!manual)}
              >
                <Text style={styles.link}>
                  {manual ? '收起手动节点' : '手动节点'}
                </Text>
              </Pressable>
              {manual && <ManualNodeForm platform={platform} />}
            </View>
          )}
        </ScrollView>
        {androidTopBarHeight > 0 && (
          <View
            pointerEvents="none"
            importantForAccessibility="no-hide-descendants"
            style={[styles.topBar, { height: androidTopBarHeight }]}
          >
            <ProgressiveBlurView
              style={StyleSheet.absoluteFill}
              direction="blurredTopClearBottom"
              blurType="light"
              blurAmount={18}
              blurRounds={2}
              startOffset={0.35}
            />
            <View style={styles.androidStatusBarTint} />
          </View>
        )}
        {detail && (
          <SubscriptionPanel
            key={detail.id}
            platform={platform}
            subscription={detail}
            onClose={closeDetails}
            onDelete={() => confirmDelete(detail.id, detail.name)}
          />
        )}
      </SafeAreaView>
      <AddSubscriptionSheet
        visible={adding}
        busy={platform.busy}
        error={platform.error}
        onClose={closeSheet}
        onSave={platform.save}
      />
    </View>
  );
}

function SubscriptionIcon() {
  return (
    <View accessible={false} style={styles.folder}>
      <View style={styles.folderBack} />
      <View style={styles.folderFront} />
    </View>
  );
}

const styles = StyleSheet.create({
  background: {
    flex: 1,
    backgroundColor: '#F4F4F4',
    backgroundImage:
      'linear-gradient(150deg, #FFFFFF 5%, #EEEEEE 56%, #F8F8F8 95%)',
  },
  screen: { flex: 1 },
  scrollEdgeConfiguration: { position: 'absolute', width: 0, height: 0 },
  topBar: { position: 'absolute', top: 0, left: 0, right: 0 },
  androidStatusBarTint: {
    ...StyleSheet.absoluteFill,
    backgroundImage:
      'linear-gradient(180deg, rgba(255,255,255,0.62) 0%, rgba(255,255,255,0.54) 35%, rgba(255,255,255,0) 100%)',
  },
  content: {
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
    paddingHorizontal: 20,
    gap: 15,
  },
  hero: {
    minHeight: 76,
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#252525',
    backgroundImage:
      'linear-gradient(108deg, #202020 5%, #383838 70%, #474747)',
  },
  tide: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: '48%',
    height: '100%',
    tintColor: color.white,
    opacity: 0.25,
  },
  connectionInfo: { flex: 1, minWidth: 0, gap: 4 },
  connectionSwitch: { alignSelf: 'center' },
  statusLine: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#AAAAAA' },
  online: { backgroundColor: '#9EC6AE' },
  state: { flexShrink: 1, fontSize: 18, fontWeight: '600', color: color.white },
  diagnosticAction: {
    minHeight: 44,
    maxWidth: '30%',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  heroLink: { color: color.white, fontSize: 13, fontWeight: '600' },
  hint: { color: '#D0D0D0', fontSize: 13, flexShrink: 1 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  title: { fontSize: 19, fontWeight: '700', color: color.ink },
  add: {
    width: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plus: { fontSize: 21, color: color.accent },
  action: {
    marginStart: 'auto',
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  link: { color: color.accent, fontSize: 13, fontWeight: '600' },
  subscriptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 13,
    minHeight: 74,
  },
  folder: {
    width: 45,
    height: 45,
    borderRadius: 14,
    backgroundColor: color.field,
  },
  folderBack: {
    position: 'absolute',
    top: 13,
    left: 11,
    width: 16,
    height: 13,
    borderRadius: 3,
    backgroundColor: '#AAAAAA',
  },
  folderFront: {
    position: 'absolute',
    top: 17,
    left: 11,
    width: 24,
    height: 15,
    borderRadius: 4,
    backgroundColor: '#525252',
  },
  subscriptionText: { flex: 1, gap: 4 },
  subscriptionName: { color: color.ink, fontSize: 16, fontWeight: '600' },
  meta: { color: color.muted, fontSize: 13 },
  chevron: { fontSize: 24, color: '#777777' },
  manual: {
    alignSelf: 'center',
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  error: { color: color.danger, fontSize: 13, lineHeight: 20 },
  pressed: { opacity: 0.65 },
});
