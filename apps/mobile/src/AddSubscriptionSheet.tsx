import HafenKeyboardInset from '../specs/HafenKeyboardInsetNativeComponent';
import { CloseIcon, color, Frost } from './Glass';
import { sheetPresentation } from './sheetMotion';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
} from 'react';
import {
  BackHandler,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedKeyboard,
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

const defaultSubscriptionName = '我的订阅';

type Props = {
  visible: boolean;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSave: (name: string, url: string) => Promise<boolean>;
};

function AndroidKeyboardInset({ bottom }: { bottom: number }) {
  const keyboard = useAnimatedKeyboard({
    isStatusBarTranslucentAndroid: true,
    isNavigationBarTranslucentAndroid: true,
  });
  const inset = useAnimatedStyle(() => ({
    height: Math.max(0, keyboard.height.value + 16 - bottom),
  }));
  return <Animated.View pointerEvents="none" style={inset} />;
}

export function AddSubscriptionSheet({
  visible,
  busy,
  error,
  onClose,
  onSave,
}: Props) {
  const [name, setName] = useState(defaultSubscriptionName);
  const [url, setUrl] = useState('');
  const hiddenFraction = useSharedValue(1);
  const sheetHeight = useSharedValue(1);
  const closing = useSharedValue(false);
  const dragOrigin = useSharedValue(0);
  const urlInput = useRef<ComponentRef<typeof TextInput>>(null);
  const insets = useSafeAreaInsets();
  const bottom = Math.max(insets.bottom, 16);
  const presentation = useRef(0);
  const presented = useRef(false);
  const saved = useRef(false);
  const cancelKeyboardWait = useRef<() => void>(undefined);

  useEffect(
    () => () => {
      cancelAnimation(hiddenFraction);
      cancelKeyboardWait.current?.();
    },
    [hiddenFraction],
  );

  const show = useCallback(() => {
    presentation.current += 1;
    presented.current = true;
    saved.current = false;
    scheduleOnUI(() => {
      'worklet';
      closing.value = false;
      hiddenFraction.value = 1;
      hiddenFraction.value = withTiming(0, sheetPresentation);
    });
  }, [closing, hiddenFraction]);

  const finishClose = useCallback(() => {
    const hide = () => {
      cancelKeyboardWait.current?.();
      presented.current = false;
      onClose();
      if (saved.current) {
        setName(defaultSubscriptionName);
        setUrl('');
      }
    };
    if (Platform.OS === 'ios' && Keyboard.isVisible()) {
      // Keep the active text field mounted until UIKit releases the keyboard window.
      const subscription = Keyboard.addListener('keyboardDidHide', hide);
      const fallback = setTimeout(hide, 500);
      cancelKeyboardWait.current = () => {
        subscription.remove();
        clearTimeout(fallback);
        cancelKeyboardWait.current = undefined;
      };
      Keyboard.dismiss();
    } else {
      Keyboard.dismiss();
      hide();
    }
  }, [onClose]);
  const dismiss = useCallback(() => {
    'worklet';
    if (closing.value) return;
    closing.value = true;
    hiddenFraction.value = withTiming(1, { duration: 200 }, finished => {
      if (finished) scheduleOnRN(finishClose);
    });
  }, [closing, finishClose, hiddenFraction]);
  const close = useCallback(() => scheduleOnUI(dismiss), [dismiss]);

  useEffect(() => {
    if (!visible) return;
    show();
    if (Platform.OS !== 'android') return;
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      close();
      return true;
    });
    return () => back.remove();
  }, [visible, show, close]);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY(8)
        .failOffsetX([-24, 24])
        .onStart(() => {
          'worklet';
          if (closing.value) return;
          cancelAnimation(hiddenFraction);
          dragOrigin.value = hiddenFraction.value;
        })
        .onUpdate(event => {
          'worklet';
          if (!closing.value)
            hiddenFraction.value = Math.max(
              0,
              dragOrigin.value + event.translationY / sheetHeight.value,
            );
        })
        .onEnd((event, completed) => {
          'worklet';
          if (closing.value) return;
          if (
            completed &&
            (event.translationY > 100 ||
              (event.translationY > 24 && event.velocityY > 800))
          ) {
            dismiss();
          } else {
            hiddenFraction.value = withSpring(0, {
              damping: 24,
              stiffness: 260,
              overshootClamping: true,
            });
          }
        }),
    [closing, dismiss, dragOrigin, hiddenFraction, sheetHeight],
  );
  const sheetAnimation = useAnimatedStyle(() => ({
    transform: [{ translateY: `${hiddenFraction.value * 100}%` as const }],
  }));
  const backdropAnimation = useAnimatedStyle(() => ({
    opacity: Math.max(0, Math.min(1, 1 - hiddenFraction.value)),
  }));

  async function save() {
    if (busy || !name.trim() || !url.trim()) return;
    const session = presentation.current;
    if (!(await onSave(name, url)) || session !== presentation.current) return;
    saved.current = true;
    if (presented.current) close();
    else {
      setName(defaultSubscriptionName);
      setUrl('');
    }
  }
  const disabled = busy || !name.trim() || !url.trim();

  if (!visible) return null;
  return (
    <GestureHandlerRootView
      accessibilityViewIsModal
      style={StyleSheet.absoluteFill}
    >
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
      <View
        pointerEvents="box-none"
        style={[styles.viewport, { paddingTop: insets.top + 12 }]}
      >
        <Animated.View
          testID="add-subscription-sheet"
          accessibilityViewIsModal
          onAccessibilityEscape={close}
          onLayout={event => {
            sheetHeight.value = Math.max(1, event.nativeEvent.layout.height);
          }}
          style={[styles.sheet, sheetAnimation, { paddingBottom: bottom }]}
        >
          <Frost sheet />
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
                  <CloseIcon />
                </Pressable>
              </View>
            </View>
          </GestureDetector>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentInsetAdjustmentBehavior="never"
            bounces={false}
            contentContainerStyle={styles.form}
          >
            <Text style={styles.label}>名称</Text>
            <TextInput
              testID="subscription-name-input"
              accessibilityLabel="订阅名称"
              value={name}
              onChangeText={value => {
                if (!busy) setName(value);
              }}
              placeholder="输入订阅名称"
              selectTextOnFocus={name === defaultSubscriptionName}
              placeholderTextColor={color.muted}
              maxLength={64}
              autoComplete="off"
              textContentType="none"
              submitBehavior="submit"
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
              onChangeText={value => {
                if (!busy) setUrl(value);
              }}
              placeholder="https://"
              placeholderTextColor={color.muted}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              textContentType="URL"
              importantForAutofill="no"
              submitBehavior="submit"
              keyboardType="url"
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
              <Text style={[styles.saveText, disabled && styles.disabledText]}>
                {busy ? '添加中…' : '添加'}
              </Text>
            </Pressable>
          </ScrollView>
          {Platform.OS === 'ios' && (
            <HafenKeyboardInset
              collapsable={false}
              bottomAdjustment={bottom - 16}
              pointerEvents="none"
            />
          )}
        </Animated.View>
        {Platform.OS === 'android' && <AndroidKeyboardInset bottom={bottom} />}
      </View>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(24,24,24,0.22)',
  },
  viewport: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    overflow: 'hidden',
    flexShrink: 1,
    backgroundColor: 'rgba(250,250,250,0.94)',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    width: '100%',
    maxWidth: 600,
    alignSelf: 'center',
  },
  dragArea: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 8 },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#B6B6B6',
    alignSelf: 'center',
    marginBottom: 12,
  },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { color: color.ink, fontSize: 22, fontWeight: '600' },
  closeButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  form: { paddingHorizontal: 24, paddingBottom: 12, gap: 12 },
  label: { fontSize: 13, color: color.muted },
  input: {
    minHeight: 52,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: color.field,
    color: color.ink,
    fontSize: 16,
    marginBottom: 6,
  },
  error: { color: color.danger, fontSize: 13, lineHeight: 20 },
  saveButton: {
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: color.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  saveText: { color: color.white, fontWeight: '700', fontSize: 16 },
  disabledButton: { backgroundColor: '#E5E5E5' },
  disabledText: { color: color.muted },
});
