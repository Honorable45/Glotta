import type { Channel, DesktopApi, Input, Output } from '@gestion/contracts';

declare global {
  interface Window {
    api: DesktopApi;
  }
}

export async function call<C extends Channel>(channel: C, input: Input<C>): Promise<Output<C>> {
  const result = await window.api.invoke(channel, input);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}
