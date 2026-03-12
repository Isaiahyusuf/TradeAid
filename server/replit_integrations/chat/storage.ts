import { db } from "../../db";
import { conversations, messages } from "@shared/schema";
import { eq, desc, and, sql } from "drizzle-orm";

export interface IChatStorage {
  getConversation(id: number, userId: string): Promise<typeof conversations.$inferSelect | undefined>;
  getAllConversations(userId: string): Promise<(typeof conversations.$inferSelect)[]>;
  createConversation(title: string, userId: string): Promise<typeof conversations.$inferSelect>;
  deleteConversation(id: number, userId: string): Promise<void>;
  getMessagesByConversation(conversationId: number, userId: string): Promise<(typeof messages.$inferSelect)[]>;
  createMessage(conversationId: number, role: string, content: string, userId: string): Promise<typeof messages.$inferSelect>;
}

let chatTenantColumnsReady: Promise<void> | null = null;

async function ensureChatTenantColumns(): Promise<void> {
  if (!chatTenantColumnsReady) {
    chatTenantColumnsReady = (async () => {
      await db.execute(sql`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS user_id TEXT`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id)`);
    })();
  }
  await chatTenantColumnsReady;
}

export const chatStorage: IChatStorage = {
  async getConversation(id: number, userId: string) {
    await ensureChatTenantColumns();
    const [conversation] = await db.select().from(conversations).where(and(eq(conversations.id, id), eq(conversations.userId, userId)));
    return conversation;
  },

  async getAllConversations(userId: string) {
    await ensureChatTenantColumns();
    return db.select().from(conversations).where(eq(conversations.userId, userId)).orderBy(desc(conversations.createdAt));
  },

  async createConversation(title: string, userId: string) {
    await ensureChatTenantColumns();
    const [conversation] = await db.insert(conversations).values({ title, userId }).returning();
    return conversation;
  },

  async deleteConversation(id: number, userId: string) {
    await ensureChatTenantColumns();
    const [conversation] = await db.select({ id: conversations.id }).from(conversations).where(and(eq(conversations.id, id), eq(conversations.userId, userId))).limit(1);
    if (!conversation) return;
    await db.delete(messages).where(eq(messages.conversationId, conversation.id));
    await db.delete(conversations).where(and(eq(conversations.id, conversation.id), eq(conversations.userId, userId)));
  },

  async getMessagesByConversation(conversationId: number, userId: string) {
    await ensureChatTenantColumns();
    return db
      .select({
        id: messages.id,
        conversationId: messages.conversationId,
        role: messages.role,
        content: messages.content,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .innerJoin(conversations, eq(messages.conversationId, conversations.id))
      .where(and(eq(messages.conversationId, conversationId), eq(conversations.userId, userId)))
      .orderBy(messages.createdAt);
  },

  async createMessage(conversationId: number, role: string, content: string, userId: string) {
    await ensureChatTenantColumns();
    const [conversation] = await db.select({ id: conversations.id }).from(conversations).where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId))).limit(1);
    if (!conversation) {
      throw new Error("conversation_not_found_or_forbidden");
    }
    const [message] = await db.insert(messages).values({ conversationId, role, content }).returning();
    return message;
  },
};

