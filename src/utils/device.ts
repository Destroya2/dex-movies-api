import crypto from 'crypto';

const BRAND_MODELS: Record<string, string[]> = {
  Samsung: ['SM-S918B', 'SM-A528B', 'SM-M336B'],
  Xiaomi: ['2201117TI', 'M2012K11AI', 'Redmi Note 11'],
  OnePlus: ['LE2111', 'CPH2449', 'IN2023'],
  Google: ['Pixel 6', 'Pixel 7', 'Pixel 8'],
  Realme: ['RMX3085', 'RMX3360', 'RMX3551'],
};

function generateDeviceId(): string {
  return crypto.randomBytes(16).toString('hex');
}

function randomBrandModel(): { brand: string; model: string } {
  const brands = Object.keys(BRAND_MODELS);
  const brand = brands[Math.floor(Math.random() * brands.length)];
  const models = BRAND_MODELS[brand];
  const model = models[Math.floor(Math.random() * models.length)];
  return { brand, model };
}

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

interface ClientInfoParams {
  packageName?: string;
  versionName?: string;
  versionCode?: number;
  osVersion?: string;
  region?: string;
  deviceId?: string;
}

function buildClientInfo(params?: ClientInfoParams): string {
  const { brand, model } = randomBrandModel();
  const deviceId = params?.deviceId || generateDeviceId();

  const info: Record<string, string | number> = {
    package_name: params?.packageName || 'com.community.oneroom',
    version_name: params?.versionName || '3.0.13.0325.03',
    version_code: params?.versionCode || 50020088,
    os: 'android',
    os_version: params?.osVersion || '13',
    device_id: deviceId,
    install_store: 'ps',
    gaid: generateUUID(),
    brand,
    model,
    system_language: 'en',
    net: 'NETWORK_WIFI',
    region: params?.region || 'US',
    timezone: 'Asia/Calcutta',
    sp_code: '',
  };

  return JSON.stringify(info);
}

export { generateDeviceId, randomBrandModel, buildClientInfo, generateUUID };
