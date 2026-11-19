import type { CodegenTypes, ViewProps } from 'react-native';
import { codegenNativeComponent } from 'react-native';

interface NativeProps extends ViewProps {
  bottomAdjustment: CodegenTypes.Double;
}

export default codegenNativeComponent<NativeProps>('HafenKeyboardInset', {
  excludedPlatforms: ['android'],
});
