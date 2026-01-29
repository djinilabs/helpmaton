import { createGraphDb } from "../duckdb/graphDb";

export type GraphSearchResult = {
  snippet: string;
  similarity: number;
  subject: string;
  predicate: string;
  object: string;
};

function escapeSqlValue(value: string): string {
  return value.replace(/'/g, "''");
}

export async function searchGraphByEntities(params: {
  workspaceId: string;
  agentId: string;
  entities: string[];
}): Promise<GraphSearchResult[]> {
  const trimmedEntities = params.entities
    .map((entity) => entity.trim())
    .filter((entity) => entity.length > 0);
  if (trimmedEntities.length === 0) {
    return [];
  }

  const graphDb = await createGraphDb(params.workspaceId, params.agentId);
  try {
    const entityList = trimmedEntities
      .map((entity) => `'${escapeSqlValue(entity)}'`)
      .join(", ");
    const sql = `SELECT source_id, target_id, label FROM facts WHERE source_id IN (${entityList}) OR target_id IN (${entityList});`;
    const rows = await graphDb.queryGraph<{
      source_id: string;
      target_id: string;
      label: string;
    }>(sql);

    return rows.map((row) => ({
      snippet: `Subject: ${row.source_id}\nPredicate: ${row.label}\nObject: ${row.target_id}`,
      similarity: 1,
      subject: row.source_id,
      predicate: row.label,
      object: row.target_id,
    }));
  } finally {
    await graphDb.close();
  }
}
