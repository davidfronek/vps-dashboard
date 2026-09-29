export type ColumnInfo = {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
  editable: boolean;
};

export type TableInfo = {
  name: string;
  rowCount: number;
  size: string;
  columns: ColumnInfo[];
};

export type RowValue = Record<string, unknown> & { __rowId: string };