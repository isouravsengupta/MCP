import { z } from "zod";
const envSchema = z.object({
    SNOWFLAKE_ACCOUNT: z.string().min(1),
    SNOWFLAKE_USERNAME: z.string().min(1),
    SNOWFLAKE_WAREHOUSE: z.string().min(1),
    SNOWFLAKE_DATABASE: z.string().min(1),
    SNOWFLAKE_SCHEMA: z.string().min(1),
    SNOWFLAKE_ROLE: z.string().optional(),
    SNOWFLAKE_AUTHENTICATOR: z.string().optional(),
    SPI_SNOWFLAKE_AUTH_MODE: z.enum(["password", "keypair", "sso"]).default("password"),
    SNOWFLAKE_PASSWORD: z.string().optional(),
    SNOWFLAKE_PRIVATE_KEY: z.string().optional(),
    SNOWFLAKE_PRIVATE_KEY_PASSPHRASE: z.string().optional(),
    SNOWFLAKE_ACCESS_TOKEN: z.string().optional()
});
export function loadSnowflakeConfig() {
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
        throw new Error(`Invalid environment: ${parsed.error.message}`);
    }
    const env = parsed.data;
    if (env.SPI_SNOWFLAKE_AUTH_MODE === "password" && !env.SNOWFLAKE_PASSWORD) {
        throw new Error("SNOWFLAKE_PASSWORD is required for password auth mode.");
    }
    if (env.SPI_SNOWFLAKE_AUTH_MODE === "keypair" && !env.SNOWFLAKE_PRIVATE_KEY) {
        throw new Error("SNOWFLAKE_PRIVATE_KEY is required for keypair auth mode.");
    }
    if (env.SPI_SNOWFLAKE_AUTH_MODE === "sso" && !env.SNOWFLAKE_AUTHENTICATOR) {
        throw new Error("SNOWFLAKE_AUTHENTICATOR is required for sso auth mode.");
    }
    return {
        account: env.SNOWFLAKE_ACCOUNT,
        username: env.SNOWFLAKE_USERNAME,
        warehouse: env.SNOWFLAKE_WAREHOUSE,
        database: env.SNOWFLAKE_DATABASE,
        schema: env.SNOWFLAKE_SCHEMA,
        role: env.SNOWFLAKE_ROLE,
        authenticator: env.SNOWFLAKE_AUTHENTICATOR,
        authMode: env.SPI_SNOWFLAKE_AUTH_MODE,
        password: env.SNOWFLAKE_PASSWORD,
        privateKey: env.SNOWFLAKE_PRIVATE_KEY,
        privateKeyPassphrase: env.SNOWFLAKE_PRIVATE_KEY_PASSPHRASE,
        accessToken: env.SNOWFLAKE_ACCESS_TOKEN
    };
}
