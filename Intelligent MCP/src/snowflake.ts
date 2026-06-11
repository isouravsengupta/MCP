import snowflake from "snowflake-sdk";
import type { SnowflakeConfig } from "./types.js";

export class SnowflakeClient {
  private connection: snowflake.Connection;
  private connected = false;

  constructor(private readonly config: SnowflakeConfig) {
    this.connection = snowflake.createConnection({
      account: config.account,
      username: config.username,
      warehouse: config.warehouse,
      database: config.database,
      schema: config.schema,
      role: config.role,
      authenticator: config.authenticator,
      password: config.authMode === "password" ? config.password : undefined,
      privateKey: config.authMode === "keypair" ? config.privateKey : undefined,
      privateKeyPass: config.privateKeyPassphrase,
      token: config.authMode === "sso" ? config.accessToken : undefined
    });
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      this.connection.connect((err) => {
        if (err) {
          reject(err);
          return;
        }
        this.connected = true;
        resolve();
      });
    });
  }

  async execute(sqlText: string, binds: Array<string | number> = []): Promise<unknown[]> {
    await this.connect();

    return await new Promise<unknown[]>((resolve, reject) => {
      this.connection.execute({
        sqlText,
        binds,
        complete: (err, _stmt, rows) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(rows ?? []);
        }
      });
    });
  }
}
