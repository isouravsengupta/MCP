import snowflake from "snowflake-sdk";
import type { SnowflakeConfig } from "./types.js";

snowflake.configure({ logLevel: "ERROR" });

export class SnowflakeClient {
  private connection: snowflake.Connection;
  private connected = false;

  constructor(private readonly config: SnowflakeConfig) {
    const opts: snowflake.ConnectionOptions = {
      account: config.account,
      username: config.username,
      warehouse: config.warehouse,
      database: config.database,
      schema: config.schema,
      role: config.role,
    };

    if (config.authMode === "password") {
      opts.password = config.password;
    } else if (config.authMode === "keypair") {
      opts.authenticator = "SNOWFLAKE_JWT";
      opts.privateKey = config.privateKey;
      opts.privateKeyPass = config.privateKeyPassphrase;
    } else if (config.authMode === "sso") {
      // Opens browser tab — only valid for local dev
      opts.authenticator = "EXTERNALBROWSER";
    }

    this.connection = snowflake.createConnection(opts);
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    await new Promise<void>((resolve, reject) => {
      this.connection.connect((err) => {
        if (err) { reject(err); return; }
        this.connected = true;
        resolve();
      });
    });
  }

  async execute<T = Record<string, unknown>>(
    sqlText: string,
    binds: Array<string | number> = []
  ): Promise<T[]> {
    await this.connect();
    return new Promise<T[]>((resolve, reject) => {
      this.connection.execute({
        sqlText,
        binds,
        complete: (err, _stmt, rows) => {
          if (err) { reject(err); return; }
          resolve((rows ?? []) as T[]);
        },
      });
    });
  }
}
