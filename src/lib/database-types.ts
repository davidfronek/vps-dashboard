export type ColumnInfo = {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
  editable: boolean;
};

export type TableInfo = {
  name: string;
  estimatedRows: number;
  size: string;
  columns: ColumnInfo[];
};