-- ReviewItemState 相关DDL，由 prisma migrate diff 离线生成
-- 注意：本库有不在 schema 里的遗留表（assignment_copy1 / assignmentstroke_copy1），
-- 禁止使用 prisma db push（会直接 DROP 它们）。本文件用于人工执行。

-- CreateTable
CREATE TABLE `review_item_state` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NULL,
    `domain` VARCHAR(16) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `status` VARCHAR(16) NOT NULL,
    `reviewStreak` INTEGER NOT NULL DEFAULT 0,
    `checkStreak` INTEGER NOT NULL DEFAULT 0,
    `checkFailStreak` INTEGER NOT NULL DEFAULT 0,
    `wrongTotal` INTEGER NOT NULL DEFAULT 0,
    `rightTotal` INTEGER NOT NULL DEFAULT 0,
    `firstWrongAt` BIGINT NOT NULL DEFAULT 0,
    `lastResultAt` BIGINT NOT NULL DEFAULT 0,
    `lastCheckAt` BIGINT NOT NULL DEFAULT 0,
    `units` JSON NULL,
    `mistakes` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `review_item_state_userId_domain_status_idx`(`userId`, `domain`, `status`),
    INDEX `review_item_state_userId_domain_lastCheckAt_idx`(`userId`, `domain`, `lastCheckAt`),
    INDEX `review_item_state_userId_updatedAt_idx`(`userId`, `updatedAt`),
    UNIQUE INDEX `review_item_state_userId_domain_key_key`(`userId`, `domain`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `review_item_state` ADD CONSTRAINT `review_item_state_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
