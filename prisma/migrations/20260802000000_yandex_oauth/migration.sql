-- ############################################################################
-- Вход через Яндекс ID.
--
-- Появляется второй способ попасть в аккаунт — наравне с passkey, а не вместо
-- него. Поэтому связь с внешним сервисом лежит отдельной таблицей: у аккаунта
-- её может не быть вовсе, может быть одна, а со временем провайдеров станет
-- больше одного.
--
-- Ключ — пара «провайдер и его идентификатор пользователя». Не почта и не
-- логин: в Яндексе меняются оба, а id закреплён за человеком навсегда. Логин и
-- почта здесь справочные — снимок на момент последнего входа, чтобы человеку
-- было видно, какой именно аккаунт привязан.
--
-- Существующих строк это не касается: таблица новая, users не меняется.
-- ############################################################################

-- CreateEnum
CREATE TYPE "oauth_provider" AS ENUM ('yandex');

-- CreateTable
CREATE TABLE "oauth_accounts" (
    "provider" "oauth_provider" NOT NULL,
    "provider_account_id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "login" TEXT,
    "email" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_login_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_accounts_pkey" PRIMARY KEY ("provider","provider_account_id")
);

-- CreateIndex
-- Один аккаунт — не больше одной учётной записи у провайдера. Заодно это и
-- индекс по user_id: «какие входы есть у этого аккаунта» читается с него же.
CREATE UNIQUE INDEX "oauth_accounts_user_id_provider_key" ON "oauth_accounts"("user_id", "provider");

-- AddForeignKey
ALTER TABLE "oauth_accounts" ADD CONSTRAINT "oauth_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
