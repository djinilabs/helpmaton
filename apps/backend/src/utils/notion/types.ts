/**
 * Notion API Types
 * Based on Notion API version 2025-09-03
 */

/**
 * Base object structure
 */
export interface NotionObject {
  object: string;
  id: string;
  created_time: string;
  last_edited_time: string;
  created_by?: {
    object: string;
    id: string;
  };
  last_edited_by?: {
    object: string;
    id: string;
  };
}

/**
 * Page object
 */
export interface NotionPage extends NotionObject {
  object: "page";
  parent: NotionParent;
  properties: Record<string, NotionProperty>;
  url: string;
  public_url?: string;
  archived?: boolean;
}

/**
 * Parent reference (can be page, database, data source, workspace, or block)
 */
export type NotionParent =
  | { type: "page_id"; page_id: string }
  | { type: "database_id"; database_id: string }
  | { type: "data_source_id"; data_source_id: string }
  | { type: "workspace"; workspace: true }
  | { type: "block_id"; block_id: string };

/**
 * Property value types
 */
export type NotionProperty =
  | NotionTitleProperty
  | NotionRichTextProperty
  | NotionNumberProperty
  | NotionSelectProperty
  | NotionMultiSelectProperty
  | NotionDateProperty
  | NotionPeopleProperty
  | NotionFilesProperty
  | NotionCheckboxProperty
  | NotionUrlProperty
  | NotionEmailProperty
  | NotionPhoneNumberProperty
  | NotionFormulaProperty
  | NotionRelationProperty
  | NotionRollupProperty
  | NotionCreatedTimeProperty
  | NotionCreatedByProperty
  | NotionLastEditedTimeProperty
  | NotionLastEditedByProperty
  | NotionStatusProperty
  | NotionUniqueIdProperty;

export interface NotionTitleProperty {
  id: string;
  type: "title";
  title: NotionRichText[];
}

export interface NotionRichTextProperty {
  id: string;
  type: "rich_text";
  rich_text: NotionRichText[];
}

export interface NotionNumberProperty {
  id: string;
  type: "number";
  number: number | null;
}

export interface NotionSelectProperty {
  id: string;
  type: "select";
  select: NotionSelectOption | null;
}

export interface NotionMultiSelectProperty {
  id: string;
  type: "multi_select";
  multi_select: NotionSelectOption[];
}

export interface NotionDateProperty {
  id: string;
  type: "date";
  date: NotionDate | null;
}

export interface NotionPeopleProperty {
  id: string;
  type: "people";
  people: NotionUser[];
}

export interface NotionFilesProperty {
  id: string;
  type: "files";
  files: NotionFile[];
}

export interface NotionCheckboxProperty {
  id: string;
  type: "checkbox";
  checkbox: boolean;
}

export interface NotionUrlProperty {
  id: string;
  type: "url";
  url: string | null;
}

export interface NotionEmailProperty {
  id: string;
  type: "email";
  email: string | null;
}

export interface NotionPhoneNumberProperty {
  id: string;
  type: "phone_number";
  phone_number: string | null;
}

export interface NotionFormulaProperty {
  id: string;
  type: "formula";
  formula: NotionFormulaValue;
}

export interface NotionRelationProperty {
  id: string;
  type: "relation";
  relation: NotionRelation[];
}

export interface NotionRollupProperty {
  id: string;
  type: "rollup";
  rollup: NotionRollupValue;
}

export interface NotionCreatedTimeProperty {
  id: string;
  type: "created_time";
  created_time: string;
}

export interface NotionCreatedByProperty {
  id: string;
  type: "created_by";
  created_by: NotionUser;
}

export interface NotionLastEditedTimeProperty {
  id: string;
  type: "last_edited_time";
  last_edited_time: string;
}

export interface NotionLastEditedByProperty {
  id: string;
  type: "last_edited_by";
  last_edited_by: NotionUser;
}

export interface NotionStatusProperty {
  id: string;
  type: "status";
  status: NotionSelectOption | null;
}

export interface NotionUniqueIdProperty {
  id: string;
  type: "unique_id";
  unique_id: {
    prefix: string | null;
    number: number;
  };
}

/**
 * Rich text structure
 */
export interface NotionRichText {
  type: "text" | "mention" | "equation";
  text?: {
    content: string;
    link?: {
      url: string;
    } | null;
  };
  mention?: NotionMention;
  equation?: {
    expression: string;
  };
  annotations: {
    bold: boolean;
    italic: boolean;
    strikethrough: boolean;
    underline: boolean;
    code: boolean;
    color: string;
  };
  plain_text: string;
  href?: string | null;
}

/**
 * Mention types
 */
export type NotionMention =
  | { type: "user"; user: NotionUser }
  | { type: "page"; page: { id: string } }
  | { type: "database"; database: { id: string } }
  | { type: "date"; date: NotionDate }
  | { type: "link_preview"; link_preview: { url: string } }
  | { type: "template_mention"; template_mention: NotionTemplateMention };

export interface NotionTemplateMention {
  type: "template_mention_date" | "template_mention_user";
  template_mention_date?: "today" | "now";
  template_mention_user?: "me";
}

/**
 * Select option
 */
export interface NotionSelectOption {
  id?: string;
  name: string;
  color?: string;
}

/**
 * Date structure
 */
export interface NotionDate {
  start: string;
  end?: string | null;
  time_zone?: string | null;
}

/**
 * User object
 */
export interface NotionUser {
  object: "user";
  id: string;
  type: "person" | "bot";
  name?: string | null;
  avatar_url?: string | null;
  person?: {
    email?: string | null;
  };
  bot?: {
    owner?: {
      type: "user" | "workspace";
      user?: NotionUser;
    };
    workspace_name?: string | null;
  };
}

/**
 * File structure
 */
export interface NotionFile {
  name: string;
  type: "external" | "file";
  external?: {
    url: string;
  };
  file?: {
    url: string;
    expiry_time?: string;
  };
}

/**
 * Formula value
 */
export type NotionFormulaValue =
  | { type: "string"; string: string | null }
  | { type: "number"; number: number | null }
  | { type: "boolean"; boolean: boolean | null }
  | { type: "date"; date: NotionDate | null };

/**
 * Relation
 */
export interface NotionRelation {
  id: string;
}

/**
 * Rollup value
 */
export type NotionRollupValue =
  | { type: "number"; number: number | null }
  | { type: "date"; date: NotionDate | null }
  | { type: "array"; array: NotionProperty[] };

/**
 * Block object
 */
export interface NotionBlock extends NotionObject {
  object: "block";
  type: string;
  has_children: boolean;
  archived?: boolean;
  [key: string]: unknown; // Block-specific properties
}

/**
 * Database object
 */
export interface NotionDatabase extends NotionObject {
  object: "database";
  title: NotionRichText[];
  description: NotionRichText[];
  icon?: NotionFile | NotionEmoji | null;
  cover?: NotionFile | null;
  properties: Record<string, NotionPropertySchema>;
  parent: NotionParent;
  url: string;
  public_url?: string;
  archived?: boolean;
  is_inline?: boolean;
}

/**
 * Data source object (new in 2025-09-03)
 */
export interface NotionDataSource extends NotionObject {
  object: "data_source";
  title: NotionRichText[];
  description: NotionRichText[];
  icon?: NotionFile | NotionEmoji | null;
  cover?: NotionFile | null;
  properties: Record<string, NotionPropertySchema>;
  parent: NotionParent;
  url: string;
  public_url?: string;
  archived?: boolean;
  database_id: string;
}

/**
 * Property schema (for database/data source properties)
 */
export interface NotionPropertySchema {
  id: string;
  name: string;
  type: string;
  [key: string]: unknown; // Property-specific schema
}

/**
 * Emoji
 */
export interface NotionEmoji {
  type: "emoji";
  emoji: string;
}

/**
 * Search response
 */
export interface NotionSearchResponse {
  object: "list";
  results: (NotionPage | NotionDatabase | NotionDataSource)[];
  next_cursor: string | null;
  has_more: boolean;
  type: "page_or_database";
  page_or_database: Record<string, unknown>;
}

/**
 * Database query response
 */
export interface NotionDatabaseQueryResponse {
  object: "list";
  results: NotionPage[];
  next_cursor: string | null;
  has_more: boolean;
  type: "page";
  page: Record<string, unknown>;
}

/**
 * Block children response
 */
export interface NotionBlockChildrenResponse {
  object: "list";
  results: NotionBlock[];
  next_cursor: string | null;
  has_more: boolean;
  type: "block";
  block: Record<string, unknown>;
}

/**
 * Error response
 */
export interface NotionErrorResponse {
  object: "error";
  status: number;
  code: string;
  message: string;
}
