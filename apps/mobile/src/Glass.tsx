import { BlurView } from '@sbaiahmed1/react-native-blur';
import {
  Image,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import type { ReactNode } from 'react';

export const color = {
  ink: '#191919',
  muted: '#616161',
  accent: '#333333',
  field: '#F2F2F2',
  success: '#52806B',
  danger: '#A64242',
  white: '#FFFFFF',
};

export function Frost({ sheet = false }: { sheet?: boolean }) {
  return (
    <>
      <BlurView
        pointerEvents="none"
        accessible={false}
        style={StyleSheet.absoluteFill}
        blurType="light"
        blurAmount={22}
        blurRounds={2}
        reducedTransparencyFallbackColor="#FAFAFA"
      />
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          sheet ? styles.sheetTint : styles.glassTint,
        ]}
      />
    </>
  );
}

export function Glass({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.shadow, style]}>
      <View style={styles.surface}>
        <Frost />
        {children}
      </View>
    </View>
  );
}

export function CloseIcon() {
  return (
    <Image
      accessible={false}
      source={require('./assets/material-symbols-close-rounded.png')}
      style={styles.closeIcon}
    />
  );
}

const styles = StyleSheet.create({
  closeIcon: { width: 24, height: 24, tintColor: color.muted },
  sheetTint: { backgroundColor: 'rgba(251,251,251,0.91)' },
  glassTint: { backgroundColor: 'rgba(255,255,255,0.62)' },
  shadow: { borderRadius: 24, boxShadow: '0px 3px 16px rgba(0,0,0,0.035)' },
  surface: {
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
});
