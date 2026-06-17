import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
const TABLE_NAME = process.env.SPI_TOKEN_TABLE ?? "spi-mcp-vibe-tokens";
const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION ?? "us-west-2" }));
export async function getToken(slackUserId) {
    const result = await client.send(new GetCommand({ TableName: TABLE_NAME, Key: { slackUserId } }));
    if (!result.Item)
        return null;
    const item = result.Item;
    if (item.expiresAt < Date.now())
        return null;
    return item;
}
export async function saveToken(token) {
    await client.send(new PutCommand({ TableName: TABLE_NAME, Item: token }));
}
export async function deleteToken(slackUserId) {
    await client.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { slackUserId } }));
}
