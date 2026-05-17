/// <reference types="@tx5dr/plugin-api/bridge" />
import { mapError } from './rotator-ui-utils';

export async function invokePlugin<T>(action: string, data?: unknown): Promise<T> {
  try {
    return await window.tx5dr.invoke(action, data) as T;
  } catch (error) {
    throw new Error(mapError(error));
  }
}
