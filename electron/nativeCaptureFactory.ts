import { app } from 'electron';
import path from 'node:path';
import { NativeCapture } from './nativeCapture';
import { PortableNativeCapture } from './portableNativeCapture';

export function createNativeCapture() {
  if (process.platform === 'darwin' || process.platform === 'linux') {
    return new PortableNativeCapture(process.env.CAPTUREPLAYER_NATIVE_ADDON || (app.isPackaged
      ? path.join(process.resourcesPath, 'native-capture', 'captureplayer.node')
      : path.join(app.getAppPath(), '.local', 'native-addon', 'captureplayer.node')));
  }
  return new NativeCapture(process.env.CAPTUREPLAYER_NATIVE_CAPTURE || (app.isPackaged
    ? path.join(path.dirname(app.getPath('exe')), 'native-capture', 'CapturePlayerCapture.exe')
    : path.join(app.getAppPath(), '.local', 'native-capture', 'CapturePlayerCapture.exe')));
}
