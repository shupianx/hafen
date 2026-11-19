import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  Keyboard,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ReorderableList, {
  reorderItems,
  useReorderableDrag,
} from 'react-native-reorderable-list';
import type { SubscriptionNodes, SubscriptionSummary } from '@hafen/domain';
import type { usePlatform } from './usePlatform';
import { CloseIcon, color, Frost } from './Glass';
import NativeHafenPlatform from '../specs/NativeHafenPlatform';
import { orderedNodes } from './nodeOrder';
import { sheetPresentation } from './sheetMotion';

type Node = SubscriptionNodes['nodes'][number];
const emptyNodes: Node[] = [];
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

function NodeRow({
  item,
  selected,
  busy,
  onSelect,
  onMove,
  index,
  count,
}: {
  item: Node;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
  onMove: (from: number, to: number) => void;
  index: number;
  count: number;
}) {
  const drag = useReorderableDrag();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={item.name + (item.blockedReason ? '，暂不可用' : '')}
      accessibilityState={{ checked: selected, disabled: busy }}
      accessibilityHint="轻点选择，长按后上下拖动排序"
      accessibilityActions={[
        ...(index > 0 ? [{ name: 'moveUp', label: '上移' }] : []),
        ...(index < count - 1 ? [{ name: 'moveDown', label: '下移' }] : []),
      ]}
      onAccessibilityAction={({ nativeEvent }) => {
        if (nativeEvent.actionName === 'moveUp') onMove(index, index - 1);
        if (nativeEvent.actionName === 'moveDown') onMove(index, index + 1);
      }}
      disabled={busy}
      onPress={item.blockedReason ? undefined : onSelect}
      onLongPress={drag}
      delayLongPress={350}
      style={[styles.node, selected && styles.selected]}
    >
      <View style={[styles.indicator, selected && styles.indicatorSelected]}>
        {selected && <Text style={styles.check}>✓</Text>}
      </View>
      <View style={styles.nodeText}>
        <Text numberOfLines={2} style={styles.nodeName}>
          {item.name}
        </Text>
        <Text style={styles.body}>
          {item.type}
          {item.blockedReason ? ' · 暂不可用' : ''}
        </Text>
      </View>
      <Text accessible={false} style={styles.grip}>
        ≡
      </Text>
    </Pressable>
  );
}

type Props = {
  platform: ReturnType<typeof usePlatform>;
  subscription: SubscriptionSummary;
  onClose: () => void;
  onDelete: () => void;
};

export function SubscriptionPanel({
  platform,
  subscription,
  onClose,
  onDelete,
}: Props) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const rest = Math.round(height * 0.34);
  const [expanded, setExpanded] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [content, setContent] = useState('');
  const [order, setOrder] = useState<string[]>([]);
  const [orderReady, setOrderReady] = useState(false);
  const [orderError, setOrderError] = useState('');
  const saving = useRef(false);
  const [savingOrder, setSavingOrder] = useState(false);
  const top = useSharedValue(height);
  const origin = useSharedValue(rest);
  const snap = useSharedValue(rest);
  const closing = useSharedValue(false);
  const presented = useRef(false);
  const { id } = subscription;
  const current = platform.openedId === id;
  const nodes = current ? platform.nodes : null;
  const data = useMemo(
    () => orderedNodes(nodes?.nodes ?? emptyNodes, order),
    [nodes, order],
  );
  const busy = platform.busy || !current || !orderReady || savingOrder;
  const transitioning =
    platform.tunnel.state === 'connecting' ||
    platform.tunnel.state === 'disconnecting';

  useEffect(() => {
    let mounted = true;
    NativeHafenPlatform?.getNodeOrder(id)
      .then(raw => {
        const ids: unknown = raw && JSON.parse(raw);
        if (mounted && Array.isArray(ids))
          setOrder(ids.filter((v): v is string => typeof v === 'string'));
      })
      .catch(() => {
        if (mounted) setOrderError('读取排列顺序失败');
      })
      .finally(() => {
        if (mounted) setOrderReady(true);
      });
    return () => {
      mounted = false;
    };
  }, [id]);

  async function move(from: number, to: number) {
    if (
      busy ||
      saving.current ||
      from === to ||
      from < 0 ||
      to < 0 ||
      from >= data.length ||
      to >= data.length
    )
      return;
    const next = reorderItems(data, from, to).map(node => node.id);
    saving.current = true;
    setSavingOrder(true);
    setOrder(next);
    setOrderError('');
    try {
      await NativeHafenPlatform!.setNodeOrder(id, JSON.stringify(next));
    } catch {
      setOrder(order);
      setOrderError('未能保存节点顺序，请重试');
    } finally {
      saving.current = false;
      setSavingOrder(false);
    }
  }

  useEffect(() => {
    const target = expanded ? 0 : rest;
    snap.value = target;
    if (presented.current && !closing.value)
      top.value = withTiming(target, { duration: 235 });
  }, [closing, expanded, rest, snap, top]);

  const close = useCallback(() => {
    if (closing.value) return;
    closing.value = true;
    Keyboard.dismiss();
    top.value = withTiming(height, { duration: 185 }, done => {
      if (done) scheduleOnRN(onClose);
    });
  }, [closing, height, onClose, top]);

  const headerPan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY([-9, 9])
        .failOffsetX([-28, 28])
        .onStart(() => {
          'worklet';
          if (closing.value) return;
          cancelAnimation(top);
          origin.value = top.value;
        })
        .onUpdate(e => {
          'worklet';
          if (!closing.value)
            top.value = Math.max(
              0,
              Math.min(height, origin.value + e.translationY),
            );
        })
        .onEnd((e, success) => {
          'worklet';
          if (closing.value) return;
          if (!success) {
            top.value = withTiming(snap.value);
            return;
          }
          const projected = top.value + 0.12 * e.velocityY;
          if (projected > rest + (height - rest) * 0.33) {
            scheduleOnRN(close);
            return;
          }
          const full =
            projected < rest / 2 || (snap.value > 0 && e.translationY < -28);
          snap.value = full ? 0 : rest;
          top.value = withTiming(snap.value, { duration: 200 });
          scheduleOnRN(setExpanded, full);
        }),
    [close, closing, height, origin, rest, snap, top],
  );

  const onListScroll = useAnimatedScrollHandler({
    onScroll: event => {
      if (event.contentOffset.y > 4 && snap.value > 0 && !closing.value) {
        snap.value = 0;
        scheduleOnRN(setExpanded, true);
      }
    },
  });

  const position = useAnimatedStyle(() => ({
    top: top.value,
    paddingTop: Math.max(0, insets.top - top.value),
    borderTopLeftRadius: Math.min(28, top.value),
    borderTopRightRadius: Math.min(28, top.value),
  }));
  const shade = useAnimatedStyle(() => ({
    opacity: 0.18 * (1 - top.value / height),
  }));
  const handleSpacing = useAnimatedStyle(() => ({
    height: interpolate(top.value, [0, rest], [12, 28], Extrapolation.CLAMP),
  }));
  const feedback = platform.error || platform.tunnelError || orderError;

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      supportedOrientations={['portrait', 'landscape']}
      onRequestClose={close}
      onShow={() => {
        if (presented.current || closing.value) return;
        presented.current = true;
        top.value = withTiming(snap.value, sheetPresentation);
      }}
    >
      <GestureHandlerRootView style={styles.overlay}>
        <Animated.View pointerEvents="none" style={[styles.shade, shade]} />
        <Pressable
          accessibilityLabel="关闭订阅详情"
          accessibilityRole="button"
          onPress={close}
          style={StyleSheet.absoluteFill}
        />
        <Animated.View
          style={[styles.sheet, position]}
          accessibilityViewIsModal
          onAccessibilityEscape={close}
        >
          <Frost sheet />
          <GestureDetector gesture={headerPan}>
            <View collapsable={false} style={styles.header}>
              <AnimatedPressable
                accessibilityRole="button"
                accessibilityLabel={expanded ? '收起订阅卡片' : '展开订阅卡片'}
                hitSlop={16}
                onPress={() => setExpanded(!expanded)}
                style={[styles.handleArea, handleSpacing]}
              >
                <View style={styles.handle} />
              </AnimatedPressable>
              <View style={styles.heading}>
                <View style={styles.leadingAction}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="关闭"
                    onPress={close}
                    style={styles.headerButton}
                  >
                    <CloseIcon />
                  </Pressable>
                </View>
                <Text
                  accessibilityRole="header"
                  numberOfLines={1}
                  style={styles.title}
                >
                  {subscription.name}
                </Text>
                <View style={styles.trailingAction}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="删除订阅"
                    disabled={platform.busy || savingOrder}
                    onPress={onDelete}
                    style={styles.headerButton}
                  >
                    <Image
                      accessible={false}
                      source={require('./assets/solar-trash-bin-trash-outline.png')}
                      style={styles.deleteIcon}
                    />
                  </Pressable>
                </View>
              </View>
              <Text numberOfLines={1} style={styles.host}>
                {subscription.host}
              </Text>
            </View>
          </GestureDetector>
          <View style={styles.list}>
            <ReorderableList
              data={data}
              keyExtractor={item => item.id}
              panActivateAfterLongPress={370}
              dragEnabled={!busy}
              onScroll={onListScroll}
              keyboardShouldPersistTaps="handled"
              automaticallyAdjustKeyboardInsets
              contentContainerStyle={[
                styles.content,
                !expanded && { minHeight: height },
                { paddingBottom: insets.bottom + 24 },
              ]}
              onReorder={({ from, to }) => move(from, to)}
              ListHeaderComponent={
                <View style={styles.controls}>
                  <View style={styles.actions}>
                    <Pressable
                      accessibilityRole="button"
                      disabled={platform.busy}
                      style={styles.button}
                      onPress={() => platform.updateSubscription(id)}
                    >
                      <Text style={styles.link}>
                        {platform.busy ? '处理中…' : '更新节点'}
                      </Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      disabled={platform.busy}
                      style={styles.button}
                      onPress={() => {
                        setShowImport(!showImport);
                        setContent('');
                        if (!showImport) setExpanded(true);
                      }}
                    >
                      <Text style={styles.link}>
                        {showImport ? '取消粘贴' : '粘贴配置'}
                      </Text>
                    </Pressable>
                  </View>
                  {showImport && (
                    <View style={styles.importBox}>
                      <TextInput
                        accessibilityLabel="订阅配置内容"
                        multiline
                        value={content}
                        onChangeText={setContent}
                        autoCapitalize="none"
                        autoCorrect={false}
                        maxLength={524288}
                        editable={!platform.busy}
                        placeholder="粘贴 YAML、JSON 或节点链接"
                        placeholderTextColor={color.muted}
                        style={styles.input}
                      />
                      <Pressable
                        accessibilityRole="button"
                        disabled={platform.busy || !content.trim()}
                        style={styles.button}
                        onPress={async () => {
                          if (await platform.updateSubscription(id, content)) {
                            Keyboard.dismiss();
                            setContent('');
                            setShowImport(false);
                          }
                        }}
                      >
                        <Text style={styles.link}>导入</Text>
                      </Pressable>
                    </View>
                  )}
                  {!!feedback && (
                    <Text accessibilityLiveRegion="polite" style={styles.error}>
                      {feedback}
                    </Text>
                  )}
                  <Text style={styles.caption}>
                    {nodes
                      ? `${data.length} 个节点${
                          nodes.skipped
                            ? ' · 跳过 ' + nodes.skipped + ' 项'
                            : ''
                        }`
                      : platform.busy
                      ? '正在读取节点…'
                      : '更新订阅或粘贴配置以获取节点'}
                  </Text>
                </View>
              }
              renderItem={({ item, index }) => (
                <NodeRow
                  item={item}
                  index={index}
                  count={data.length}
                  selected={platform.selectedId === item.id}
                  busy={busy || transitioning}
                  onMove={move}
                  onSelect={() => platform.selectNode(item.id)}
                />
              )}
            />
          </View>
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1 },
  shade: { ...StyleSheet.absoluteFill, backgroundColor: color.ink },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    overflow: 'hidden',
    backgroundColor: 'rgba(249,249,249,0.94)',
  },
  header: { paddingHorizontal: 22, paddingBottom: 15 },
  handleArea: {
    width: 80,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
  },
  handle: { width: 36, height: 4, backgroundColor: '#B6B6B6', borderRadius: 2 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  leadingAction: { flex: 1, minWidth: 44, alignItems: 'flex-start' },
  trailingAction: { flex: 1, minWidth: 44, alignItems: 'flex-end' },
  title: {
    maxWidth: '60%',
    fontSize: 17,
    fontWeight: '600',
    color: color.ink,
    textAlign: 'center',
    flexShrink: 1,
  },
  host: { textAlign: 'center', fontSize: 13, color: color.muted },
  headerButton: {
    minWidth: 44,
    minHeight: 44,
    paddingHorizontal: 8,
    borderRadius: 22,
    backgroundColor: color.field,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteIcon: { width: 22, height: 22, tintColor: color.danger },
  list: { flex: 1 },
  content: { paddingHorizontal: 20 },
  controls: { gap: 12 },
  actions: { flexDirection: 'row', gap: 8 },
  button: {
    minHeight: 44,
    backgroundColor: '#EAEAEA',
    borderRadius: 14,
    paddingHorizontal: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  link: { color: color.accent, fontSize: 14, fontWeight: '600' },
  caption: { color: color.muted, marginTop: 4, marginBottom: 10, fontSize: 13 },
  node: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    minHeight: 66,
    backgroundColor: color.field,
    borderRadius: 16,
    marginBottom: 6,
  },
  selected: { backgroundColor: '#E3E3E3' },
  indicator: {
    width: 17,
    height: 17,
    borderRadius: 9,
    backgroundColor: '#D5D5D5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  indicatorSelected: { backgroundColor: color.accent },
  check: { color: color.white, fontSize: 12, fontWeight: '700' },
  nodeText: { flex: 1, gap: 2 },
  nodeName: { color: color.ink, fontSize: 16, fontWeight: '600' },
  body: { color: color.muted, fontSize: 13 },
  grip: { color: color.muted, fontSize: 21 },
  importBox: { gap: 6 },
  input: {
    minHeight: 100,
    maxHeight: 175,
    borderRadius: 14,
    backgroundColor: color.field,
    color: color.ink,
    padding: 14,
    textAlignVertical: 'top',
  },
  error: { color: color.danger, fontSize: 13 },
});
