import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
} from 'react';
import {
  Dimensions,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Props = {
  visible: boolean;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSave: (name: string, url: string) => Promise<boolean>;
};

export function AddSubscriptionSheet({
  visible,
  busy,
  error,
  onClose,
  onSave,
}: Props) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const translation = useSharedValue(Dimensions.get('screen').height);
  const closing = useSharedValue(false);
  const dragOrigin = useSharedValue(0);
  const urlInput = useRef<ComponentRef<typeof TextInput>>(null);
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const screenHeight = Dimensions.get('screen').height;

  useEffect(() => () => cancelAnimation(translation), [translation]);

  const show = useCallback(() => {
    scheduleOnUI(() => {
      'worklet';
      closing.value = false;
      translation.value = screenHeight;
      translation.value = withTiming(0, { duration: 260 });
    });
  }, [closing, screenHeight, translation]);

  const dismissKeyboard = useCallback(() => Keyboard.dismiss(), []);
  const dismiss = useCallback(() => {
    'worklet';
    if (closing.value) return;
    closing.value = true;
    scheduleOnRN(dismissKeyboard);
    translation.value = withTiming(
      screenHeight,
      { duration: 200 },
      finished => {
        if (finished) scheduleOnRN(onClose);
      },
    );
  }, [closing, dismissKeyboard, onClose, screenHeight, translation]);
  const close = useCallback(() => scheduleOnUI(dismiss), [dismiss]);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY(8)
        .failOffsetX([-24, 24])
        .onStart(() => {
          'worklet';
          if (closing.value) return;
          cancelAnimation(translation);
          dragOrigin.value = translation.value;
        })
        .onUpdate(event => {
          'worklet';
          if (!closing.value)
            translation.value = Math.max(
              0,
              dragOrigin.value + event.translationY,
            );
        })
        .onEnd(event => {
          'worklet';
          if (closing.value) return;
          if (
            event.translationY > 100 ||
            (event.translationY > 24 && event.velocityY > 800)
          ) {
            dismiss();
          }
        })
        .onFinalize(() => {
          'worklet';
          if (!closing.value)
            translation.value = withSpring(0, { damping: 24, stiffness: 260 });
        }),
    [closing, dismiss, dragOrigin, translation],
  );
  const sheetAnimation = useAnimatedStyle(() => ({
    transform: [{ translateY: translation.value }],
  }));
  const backdropAnimation = useAnimatedStyle(() => ({
    opacity: Math.max(0, Math.min(1, 1 - translation.value / height)),
  }));

  async function save() {
    if (busy || !name.trim() || !url.trim()) return;
    if (await onSave(name, url)) {
      setName('');
      setUrl('');
      close();
    }
  }
  const disabled = busy || !name.trim() || !url.trim();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={close}
      onShow={show}
      supportedOrientations={['portrait', 'landscape']}
    >
      <GestureHandlerRootView style={styles.overlay}>
        <Animated.View
          pointerEvents="none"
          style={[styles.backdrop, backdropAnimation]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="关闭添加订阅"
          testID="subscription-sheet-backdrop"
          style={StyleSheet.absoluteFill}
          onPress={close}
        />
        <KeyboardAvoidingView
          pointerEvents="box-none"
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.keyboard}
        >
          <Animated.View
            testID="add-subscription-sheet"
            accessibilityViewIsModal
            onAccessibilityEscape={close}
            style={[
              styles.sheet,
              sheetAnimation,
              {
                maxHeight: height - insets.top - 16,
                paddingBottom: Math.max(insets.bottom, 16),
              },
            ]}
          >
            <GestureDetector gesture={pan}>
              <View style={styles.dragArea} collapsable={false}>
                <View style={styles.handle} />
                <View style={styles.heading}>
                  <Text accessibilityRole="header" style={styles.title}>
                    添加订阅
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="关闭"
                    onPress={close}
                    style={styles.closeButton}
                  >
                    <Text style={styles.closeIcon}>×</Text>
                  </Pressable>
                </View>
              </View>
            </GestureDetector>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              bounces={false}
              contentContainerStyle={styles.form}
            >
              <Text style={styles.label}>名称</Text>
              <TextInput
                testID="subscription-name-input"
                accessibilityLabel="订阅名称"
                value={name}
                onChangeText={setName}
                editable={!busy}
                placeholder="我的订阅"
                placeholderTextColor="#788a9d"
                maxLength={64}
                returnKeyType="next"
                onSubmitEditing={() => urlInput.current?.focus()}
                style={styles.input}
              />
              <Text style={styles.label}>链接</Text>
              <TextInput
                ref={urlInput}
                testID="subscription-url-input"
                accessibilityLabel="订阅链接"
                value={url}
                onChangeText={setUrl}
                editable={!busy}
                placeholder="https://"
                placeholderTextColor="#788a9d"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                secureTextEntry
                maxLength={8192}
                returnKeyType="done"
                onSubmitEditing={save}
                style={styles.input}
              />
              {!!error && (
                <Text accessibilityLiveRegion="polite" style={styles.error}>
                  {error}
                </Text>
              )}
              <Pressable
                testID="save-subscription"
                accessibilityRole="button"
                accessibilityState={{ disabled, busy }}
                disabled={disabled}
                onPress={save}
                style={[styles.saveButton, disabled && styles.disabledButton]}
              >
                <Text
                  style={[styles.saveText, disabled && styles.disabledText]}
                >
                  {busy ? '添加中…' : '添加'}
                </Text>
              </Pressable>
            </ScrollView>
          </Animated.View>
        </KeyboardAvoidingView>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1 },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: '#00000099' },
  keyboard: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    flexShrink: 1,
    backgroundColor: '#152334',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderColor: '#2a3a4c',
    width: '100%',
    maxWidth: 600,
    alignSelf: 'center',
  },
  dragArea: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 8 },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#526174',
    alignSelf: 'center',
    marginBottom: 12,
  },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { color: '#f0f5fa', fontSize: 22, fontWeight: '600' },
  closeButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeIcon: { color: '#a7b6c8', fontSize: 28, lineHeight: 32 },
  form: { paddingHorizontal: 24, paddingBottom: 12, gap: 12 },
  label: { fontSize: 13, color: '#a7b6c8' },
  input: {
    minHeight: 52,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: '#0d1927',
    color: '#f0f5fa',
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#314359',
    marginBottom: 6,
  },
  error: { color: '#ffb4a9', fontSize: 13, lineHeight: 20 },
  saveButton: {
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: '#7ce3c2',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  saveText: { color: '#0c302a', fontWeight: '700', fontSize: 16 },
  disabledButton: { backgroundColor: '#26384b' },
  disabledText: { color: '#8c9db0' },
});
