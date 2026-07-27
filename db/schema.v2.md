# Схема данных v2 — диаграммы

## Таблицы

```mermaid
erDiagram
    users ||--o{ credentials         : "passkeys"
    users ||--o{ sessions            : "сессии"
    users ||--o{ webauthn_challenges : "челленджи"
    users ||--o{ tournaments         : "owner_id"
    users ||--o{ people              : "owner_id — ростер организатора"
    users |o--o{ people              : "user_id — свой аккаунт (задел)"

    people      ||--o{ tournament_players : "кто именно"
    tournaments ||--o{ tournament_players : "состав"
    tournaments ||--o{ matches            : "расписание"

    matches            ||--|{ match_participants : "ровно 4 строки"
    tournament_players ||--o{ match_participants : "участие"

    users {
        uuid     id           PK
        text     username     "как ввёл пользователь"
        text     username_key UK "normalizeKey(username)"
        text     display_name
        timestamptz created_at
        timestamptz updated_at
    }

    credentials {
        text     id           PK "base64url credential ID"
        uuid     user_id      FK
        bytea    public_key
        bigint   counter
        text     transports
        text     device_type  "singleDevice | multiDevice"
        boolean  backed_up
        text     label        "iPhone, Рабочий ноут"
        timestamptz created_at
        timestamptz last_used_at
    }

    webauthn_challenges {
        uuid     id           PK
        text     challenge
        enum     kind         "registration | authentication"
        uuid     user_id      FK "nullable"
        text     username     "nullable"
        uuid     user_handle  "станет users.id"
        timestamptz expires_at
    }

    sessions {
        bytea    token_hash   PK "sha256 значения из cookie"
        uuid     user_id      FK
        timestamptz created_at
        timestamptz last_used_at
        timestamptz expires_at
    }

    people {
        uuid     id           PK
        uuid     owner_id     FK "чей ростер"
        text     name         "как ввёл организатор"
        text     name_key     UK "normalizeKey(name), уникально с owner_id"
        uuid     user_id      FK "nullable — личный аккаунт игрока"
        timestamptz archived_at "вместо удаления"
        timestamptz created_at
        timestamptz updated_at
    }

    tournaments {
        uuid     id               PK
        uuid     owner_id         FK
        text     name
        enum     format           "americano | mexicano | team_americano"
        smallint courts           "1..16"
        smallint points_per_match "1..200"
        timestamptz completed_at  "внесён счёт последнего матча"
        timestamptz closed_at     "завершён досрочно"
        timestamptz created_at
        timestamptz updated_at
    }

    tournament_players {
        uuid     id            PK
        uuid     tournament_id FK
        uuid     person_id     FK "NOT NULL, ON DELETE RESTRICT"
        smallint seat          UK "0-based, порядок ввода"
    }

    matches {
        uuid     id            PK
        uuid     tournament_id FK
        smallint round_no      UK "уникально с court_no"
        smallint court_no      UK
        smallint points_sum    "копия нормы турнира"
        smallint score_a       "nullable"
        smallint score_b       "nullable"
        timestamptz played_at  "nullable"
        timestamptz created_at
    }

    match_participants {
        uuid     match_id             PK,FK
        uuid     tournament_player_id PK,FK
        uuid     tournament_id        FK "в составном FK"
        smallint round_no             "копия matches.round_no"
        enum     side                 UK "a | b"
        smallint slot                 UK "1 | 2"
    }
```

## Что проверяет сама база

```mermaid
flowchart TB
    subgraph mp["match_participants"]
        direction TB
        A["PRIMARY KEY<br/>(match_id, tournament_player_id)"] --> A1["игрок не встречается<br/>в матче дважды"]
        B["UNIQUE<br/>(match_id, side, slot)<br/>+ slot ∈ 1,2"] --> B1["на стороне<br/>не больше двух"]
        C["FK (tournament_player_id,<br/>tournament_id)"] --> C1["участник — из турнира<br/>этого матча"]
        D["UNIQUE (tournament_id,<br/>round_no, tournament_player_id)"] --> D1["игрок не занят на двух<br/>кортах в одном раунде"]
        E["CONSTRAINT TRIGGER<br/>DEFERRABLE"] --> E1["ровно четверо,<br/>не трое"]
    end

    subgraph m["matches"]
        direction TB
        F["CHECK score_a IS NULL<br/>= score_b IS NULL"] --> F1["матч сыгран<br/>целиком или никак"]
        G["CHECK score_a + score_b<br/>= points_sum"] --> G1["сумма очков<br/>равна норме"]
    end
```

## Производные представления

Ничего вычислимого не хранится: статус турнира, таблица и сводка по людям —
вью над общей базой `match_results`. Рассинхронизироваться нечему.

```mermaid
flowchart LR
    matches[(matches)]                       --> MR[match_results]
    mparts[(match_participants)]             --> MR
    people[(people)]                         --> PC[person_career]
    tplayers[(tournament_players)]           --> TS[tournament_standings]
    tplayers                                 --> PC
    MR --> TS[tournament_standings]
    MR --> PC
    tournaments[(tournaments)]               --> TO[tournament_overview]
    matches --> TO
    tplayers --> TO

    TO -.-> S1["is_finished, finished_at,<br/>closed_early, счётчики"]
    TS -.-> S2["итоговая таблица турнира"]
    PC -.-> S3["сводка по человеку<br/>за всё время"]
```
