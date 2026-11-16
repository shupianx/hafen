import type { TurboModule, CodegenTypes } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface Spec extends TurboModule {
  readonly onVpnStateChanged: CodegenTypes.EventEmitter<string>;
  getEnvironment(): Promise<string>;
  startVpn(profile: string): Promise<string>;
  stopVpn(): Promise<string>;
  getVpnState(): Promise<string>;
  getVpnDiagnostics(): Promise<string>;
  prepareVpn(): Promise<boolean>;
  listSubscriptions(): Promise<string>;
  listSubscriptionNodes(id: string): Promise<string>;
  refreshSubscription(id: string): Promise<string>;
  importSubscription(id: string, content: string): Promise<string>;
  startSubscriptionNode(
    id: string,
    revision: string,
    nodeId: string,
  ): Promise<string>;
  saveSubscription(name: string, sourceUrl: string): Promise<string>;
  deleteSubscription(id: string): Promise<void>;
  checkCoreProfile(profile: string): Promise<void>;
  runCoreSelfTest(): Promise<string>;
}

export default TurboModuleRegistry.get<Spec>('NativeHafenPlatform');
