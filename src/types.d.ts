declare module 'vitest' {
  export const describe: (...args: any[]) => any;
  export const it: (...args: any[]) => any;
  export const expect: any;
  export const beforeEach: (...args: any[]) => any;
  export const vi: any;
}

declare module 'jsdom' {
  export class JSDOM {
    constructor(html?: string, options?: any);
    window: Window & typeof globalThis;
  }
}
