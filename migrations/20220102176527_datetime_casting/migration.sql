-- Manual migration to cast DateTime Column from "2021-12-29 20:16:54.221 +00:00" format to timestamp

UPDATE FileCache SET createdAt = CAST(strftime('%s', createdAt) AS INT) ,updatedAt = CAST(strftime('%s', updatedAt) AS INT), accessedAt = CAST(strftime('%s', accessedAt) AS INT);
UPDATE KeyValueCache SET createdAt = CAST(strftime('%s', createdAt) AS INT) ,updatedAt = CAST(strftime('%s', updatedAt) AS INT), expiresAt = CAST(strftime('%s', expiresAt) AS INT);
UPDATE Setting SET createdAt = CAST(strftime('%s', createdAt) AS INT) ,updatedAt = CAST(strftime('%s', updatedAt) AS INT);
UPDATE Shortcut SET createdAt = CAST(strftime('%s', createdAt) AS INT) ,updatedAt = CAST(strftime('%s', updatedAt) AS INT);