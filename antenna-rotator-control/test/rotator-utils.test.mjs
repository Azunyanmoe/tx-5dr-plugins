import assert from 'node:assert/strict';
import test from 'node:test';
import {
  angularDistance,
  coerceRotatorConfig,
  isAzimuthWithinSoftLimits,
  normalizeAzimuth,
  requiresLargeStepConfirmation,
  validateTargetAzimuth,
} from '../dist/rotator-utils.js';
import plugin from '../dist/index.js';

test('manifest declares a global RadioControl toolbar iframe panel', () => {
  assert.equal(plugin.name, 'antenna-rotator-control');
  assert.equal(plugin.type, 'utility');
  assert.equal(plugin.instanceScope, 'global');
  assert.equal(plugin.panels[0].slot, 'radio-control-toolbar');
  assert.equal(plugin.panels[0].component, 'iframe');
  assert.equal(plugin.panels[0].openMode, 'popover');
  assert.equal(plugin.panels[0].uiSize, 'lg');
  assert.equal(plugin.ui.pages[0].resourceBinding, 'none');
});

test('normalizes azimuth and measures shortest angular distance', () => {
  assert.equal(normalizeAzimuth(370), 10);
  assert.equal(normalizeAzimuth(-10), 350);
  assert.equal(angularDistance(350, 10), 20);
  assert.equal(angularDistance(90, 270), 180);
});

test('supports soft limit ranges that cross north', () => {
  assert.equal(isAzimuthWithinSoftLimits(350, 300, 60), true);
  assert.equal(isAzimuthWithinSoftLimits(30, 300, 60), true);
  assert.equal(isAzimuthWithinSoftLimits(180, 300, 60), false);
  assert.equal(isAzimuthWithinSoftLimits(180, 0, 360), true);
});

test('coerces unsafe config values to bounded defaults', () => {
  const config = coerceRotatorConfig({
    connectionMode: 'serial',
    rotModel: '601',
    serialPort: ' /dev/ttyUSB0 ',
    pollIntervalMs: 1,
    movementTimeoutMs: 9999999,
    presets: [{ label: 'JA', azimuth: '45' }, { label: '', azimuth: 'bad' }],
    conf: { serial_speed: 9600 },
    northOffsetDeg: '12.5',
  });
  assert.equal(config.connectionMode, 'serial');
  assert.equal(config.rotModel, 601);
  assert.equal(config.serialPort, '/dev/ttyUSB0');
  assert.equal(config.northOffsetDeg, 12.5);
  assert.equal(config.pollIntervalMs, 500);
  assert.equal(config.movementTimeoutMs, 600000);
  assert.deepEqual(config.presets, [{ label: 'JA', azimuth: 45 }]);
  assert.deepEqual(config.conf, { serial_speed: '9600' });
});

test('forces network mode to Hamlib NET rotctl model', () => {
  const config = coerceRotatorConfig({
    connectionMode: 'network',
    rotModel: '601',
    modelName: 'Yaesu GS-232A azimuth',
    networkAddress: ' 192.168.1.20:4533 ',
  });
  assert.equal(config.connectionMode, 'network');
  assert.equal(config.rotModel, 2);
  assert.equal(config.modelName, 'NET rotctl');
  assert.equal(config.networkAddress, '192.168.1.20:4533');
});

test('flags large movements and rejects out-of-limit targets', () => {
  assert.equal(requiresLargeStepConfirmation(0, 120, 90), true);
  assert.equal(requiresLargeStepConfirmation(350, 10, 90), false);
  const config = coerceRotatorConfig({ softMinAz: 20, softMaxAz: 200 });
  assert.doesNotThrow(() => validateTargetAzimuth(config, 120));
  assert.throws(() => validateTargetAzimuth(config, 300), /azimuth_out_of_soft_limits/);
});
