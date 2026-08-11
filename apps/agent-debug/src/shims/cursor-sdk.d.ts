/** Ambient stub so the server typechecks without requiring @cursor/sdk installed. */
declare module "@cursor/sdk" {
  export const Agent: {
    create(opts: Record<string, unknown>): Promise<{
      send: (prompt: string) => Promise<{ wait: () => Promise<unknown> }>;
      close?: () => Promise<void>;
      [Symbol.asyncDispose]?: () => Promise<void>;
    }>;
    prompt?: (
      prompt: string,
      opts: Record<string, unknown>,
    ) => Promise<unknown>;
  };
}
