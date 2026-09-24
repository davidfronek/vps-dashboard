export type TodoPriority = "low" | "medium" | "high";

export type TodoItem = {
  id: string;
  title: string;
  description: string;
  priority: TodoPriority;
  completed: boolean;
  createdAt: string;
  updatedAt: string;
};
