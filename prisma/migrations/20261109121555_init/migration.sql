-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('member', 'editor', 'admin');

-- CreateEnum
CREATE TYPE "ItemType" AS ENUM ('assignment', 'task', 'project', 'note', 'tip');

-- CreateEnum
CREATE TYPE "DueSource" AS ENUM ('ai', 'rule', 'manual');

-- CreateEnum
CREATE TYPE "ItemStatus" AS ENUM ('active', 'expired', 'removed');

-- CreateTable
CREATE TABLE "Group" (
    "id" SERIAL NOT NULL,
    "telegramChatId" BIGINT NOT NULL,
    "title" TEXT NOT NULL,
    "isForum" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "summaryTopicId" INTEGER,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Lagos',
    "botRemovedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Topic" (
    "id" SERIAL NOT NULL,
    "groupId" INTEGER NOT NULL,
    "threadId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Topic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "telegramUserId" BIGINT NOT NULL,
    "firstName" TEXT NOT NULL,
    "dmOptIn" BOOLEAN NOT NULL DEFAULT false,
    "lastCatchupAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupMember" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "groupId" INTEGER NOT NULL,
    "role" "MemberRole" NOT NULL DEFAULT 'member',

    CONSTRAINT "GroupMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" SERIAL NOT NULL,
    "groupId" INTEGER NOT NULL,
    "topicId" INTEGER,
    "telegramMessageId" INTEGER NOT NULL,
    "senderId" INTEGER,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "editedAt" TIMESTAMP(3),
    "text" TEXT,
    "links" TEXT[],
    "replyToMessageId" INTEGER,
    "hasFile" BOOLEAN NOT NULL DEFAULT false,
    "fileName" TEXT,
    "fileType" TEXT,
    "mimeType" TEXT,
    "processedAt" TIMESTAMP(3),
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Item" (
    "id" SERIAL NOT NULL,
    "groupId" INTEGER NOT NULL,
    "type" "ItemType" NOT NULL,
    "title" TEXT NOT NULL,
    "courseCode" TEXT,
    "summary" TEXT,
    "dueAt" TIMESTAMP(3),
    "dueDateUncertain" BOOLEAN NOT NULL DEFAULT false,
    "dueSource" "DueSource",
    "firstMessageId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" "ItemStatus" NOT NULL DEFAULT 'active',

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemSource" (
    "id" SERIAL NOT NULL,
    "itemId" INTEGER NOT NULL,
    "messageId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemChange" (
    "id" SERIAL NOT NULL,
    "itemId" INTEGER NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "changedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SummaryLog" (
    "id" SERIAL NOT NULL,
    "groupId" INTEGER NOT NULL,
    "summaryDate" TEXT NOT NULL,
    "telegramMessageIds" INTEGER[],
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SummaryLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessedUpdate" (
    "updateId" BIGINT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedUpdate_pkey" PRIMARY KEY ("updateId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Group_telegramChatId_key" ON "Group"("telegramChatId");

-- CreateIndex
CREATE UNIQUE INDEX "Topic_groupId_threadId_key" ON "Topic"("groupId", "threadId");

-- CreateIndex
CREATE UNIQUE INDEX "User_telegramUserId_key" ON "User"("telegramUserId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupMember_userId_groupId_key" ON "GroupMember"("userId", "groupId");

-- CreateIndex
CREATE INDEX "Message_groupId_processedAt_idx" ON "Message"("groupId", "processedAt");

-- CreateIndex
CREATE INDEX "Message_sentAt_idx" ON "Message"("sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "Message_groupId_telegramMessageId_key" ON "Message"("groupId", "telegramMessageId");

-- CreateIndex
CREATE INDEX "Item_groupId_status_expiresAt_idx" ON "Item"("groupId", "status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ItemSource_itemId_messageId_key" ON "ItemSource"("itemId", "messageId");

-- CreateIndex
CREATE UNIQUE INDEX "SummaryLog_groupId_summaryDate_key" ON "SummaryLog"("groupId", "summaryDate");

-- CreateIndex
CREATE INDEX "ProcessedUpdate_processedAt_idx" ON "ProcessedUpdate"("processedAt");

-- AddForeignKey
ALTER TABLE "Topic" ADD CONSTRAINT "Topic_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemSource" ADD CONSTRAINT "ItemSource_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemSource" ADD CONSTRAINT "ItemSource_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemChange" ADD CONSTRAINT "ItemChange_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SummaryLog" ADD CONSTRAINT "SummaryLog_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
