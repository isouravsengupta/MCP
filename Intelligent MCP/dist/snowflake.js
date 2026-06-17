import snowflake from "snowflake-sdk";
export class SnowflakeClient {
    config;
    connection;
    connected = false;
    constructor(config) {
        this.config = config;
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
    async connect() {
        if (this.connected) {
            return;
        }
        await new Promise((resolve, reject) => {
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
    async execute(sqlText, binds = []) {
        await this.connect();
        return await new Promise((resolve, reject) => {
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
