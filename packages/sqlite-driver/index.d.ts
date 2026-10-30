declare namespace Database {
  interface Statement {
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    run(...params: unknown[]): unknown;
  }
  interface Connection {
    exec(sql: string): void;
    pragma(sql: string, options?: { simple?: boolean }): unknown;
    prepare(sql: string): Statement;
    transaction<T extends (...args: never[]) => unknown>(fn: T): T;
    close(): void;
    defaultSafeIntegers(on: boolean): void;
  }
  interface Options {
    encryptionKey: string;
    readonly?: boolean;
  }
}
declare const Database: new (path: string, options: Database.Options) => Database.Connection;
export = Database;
