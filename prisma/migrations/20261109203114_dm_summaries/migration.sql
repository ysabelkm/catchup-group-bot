-- AlterTable
ALTER TABLE "User" ADD COLUMN     "dmSummaries" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "DmSummaryLog" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "summaryDate" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DmSummaryLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DmSummaryLog_userId_summaryDate_key" ON "DmSummaryLog"("userId", "summaryDate");

-- AddForeignKey
ALTER TABLE "DmSummaryLog" ADD CONSTRAINT "DmSummaryLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
