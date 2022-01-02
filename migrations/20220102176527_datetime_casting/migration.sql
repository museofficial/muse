-- Manual migration to cast DateTime Column from "2021-12-29 20:16:54.221 +00:00" format to timestamp

UPDATE FileCaches SET createdAt = CAST(strftime('%s', createdAt) AS INT) ,updatedAt = CAST(strftime('%s', updatedAt) AS INT), accessedAt = CAST(strftime('%s', accessedAt) AS INT);
UPDATE KeyValueCaches SET createdAt = CAST(strftime('%s', createdAt) AS INT) ,updatedAt = CAST(strftime('%s', updatedAt) AS INT), expiresAt = CAST(strftime('%s', expiresAt) AS INT);
UPDATE Settings SET createdAt = CAST(strftime('%s', createdAt) AS INT) ,updatedAt = CAST(strftime('%s', updatedAt) AS INT);
UPDATE Shortcuts SET createdAt = CAST(strftime('%s', createdAt) AS INT) ,updatedAt = CAST(strftime('%s', updatedAt) AS INT);