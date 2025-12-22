import { useState } from "react";
import type { FC } from "react";

import type { ClientTool } from "../utils/api";
import {
  jsonSchemaToParameterSchema,
  parameterSchemaToJsonSchema,
} from "../utils/jsonSchemaUtils";

import {
  ClientToolParameterBuilder,
  type ParameterSchema,
} from "./ClientToolParameterBuilder";

interface ClientToolEditorProps {
  tools: ClientTool[];
  onChange: (tools: ClientTool[]) => void;
}

export const ClientToolEditor: FC<ClientToolEditorProps> = ({
  tools,
  onChange,
}) => {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingTool, setEditingTool] = useState<Partial<ClientTool> | null>(
    null
  );

  const startEditing = (index: number | null) => {
    if (index !== null && tools[index]) {
      setEditingTool({
        ...tools[index],
        parameters: jsonSchemaToParameterSchema(
          tools[index].parameters as Record<string, unknown>
        ) as unknown as Record<string, unknown>,
      });
    } else {
      setEditingTool({
        name: "",
        description: "",
        parameters: { type: "object", properties: {} } as unknown as Record<
          string,
          unknown
        >,
      });
    }
    setEditingIndex(index);
  };

  const saveTool = () => {
    if (!editingTool) return;

    // Validate
    if (!editingTool.name || !editingTool.description) {
      alert("Please fill in all required fields: name and description");
      return;
    }

    // Validate name is a valid JavaScript identifier
    if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(editingTool.name)) {
      alert(
        "Tool name must be a valid JavaScript identifier (letters, numbers, underscore, $; no spaces or special characters)"
      );
      return;
    }

    // Convert parameter schema to JSON Schema
    const parameters = parameterSchemaToJsonSchema(
      editingTool.parameters as unknown as ParameterSchema
    );

    const newTool: ClientTool = {
      name: editingTool.name,
      description: editingTool.description,
      parameters,
    };

    if (editingIndex !== null) {
      // Update existing tool
      const newTools = [...tools];
      newTools[editingIndex] = newTool;
      onChange(newTools);
    } else {
      // Add new tool
      onChange([...tools, newTool]);
    }

    setEditingIndex(null);
    setEditingTool(null);
  };

  const deleteTool = (index: number) => {
    if (confirm("Are you sure you want to delete this tool?")) {
      const newTools = tools.filter((_, i) => i !== index);
      onChange(newTools);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold dark:text-neutral-50">Client-Side Tools</h3>
        <button
          type="button"
          onClick={() => startEditing(null)}
          className="px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
        >
          + Add Tool
        </button>
      </div>

      {editingIndex !== null || editingTool ? (
        <div className="border border-neutral-300 rounded-lg p-4 space-y-4 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800">
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1 dark:text-neutral-300">
              Tool Name (Function Name) *
            </label>
            <input
              type="text"
              value={editingTool?.name || ""}
              onChange={(e) => {
                const value = e.target.value;
                // Only allow valid JavaScript identifiers
                const validIdentifier =
                  /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(value) || value === "";
                if (validIdentifier) {
                  setEditingTool({ ...editingTool, name: value });
                }
              }}
              className="w-full border border-neutral-300 rounded px-3 py-2 font-mono dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50"
              placeholder="e.g., getWeather"
            />
            <p className="text-xs text-neutral-500 mt-1 dark:text-neutral-300">
              Must be a valid JavaScript identifier (letters, numbers,
              underscore, $; no spaces or special characters)
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1 dark:text-neutral-300">
              Description *
            </label>
            <textarea
              value={editingTool?.description || ""}
              onChange={(e) =>
                setEditingTool({ ...editingTool, description: e.target.value })
              }
              className="w-full border border-neutral-300 rounded px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50"
              rows={3}
              placeholder="Describe what this tool does for the AI"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1 dark:text-neutral-300">
              Parameters Schema
            </label>
            <ClientToolParameterBuilder
              schema={
                (editingTool?.parameters as unknown as ParameterSchema) ||
                ({ type: "object", properties: {} } as ParameterSchema)
              }
              onChange={(schema) => {
                setEditingTool({
                  ...editingTool,
                  parameters: schema as unknown as Record<string, unknown>,
                });
              }}
            />
          </div>

          <div className="flex space-x-2">
            <button
              type="button"
              onClick={saveTool}
              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setEditingIndex(null);
                setEditingTool(null);
              }}
              className="px-4 py-2 bg-neutral-300 text-neutral-700 rounded hover:bg-neutral-400 dark:bg-neutral-700 dark:text-neutral-50 dark:hover:bg-neutral-600"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {tools.length > 0 && (
        <div className="space-y-2">
          {tools.map((tool, index) => (
            <div
              key={index}
              className="border border-neutral-300 rounded p-3 flex items-start justify-between dark:border-neutral-700 dark:bg-neutral-900"
            >
              <div className="flex-1">
                <div className="font-medium dark:text-neutral-50">{tool.name}</div>
                <div className="text-sm text-neutral-600 mt-1 dark:text-neutral-300">
                  {tool.description}
                </div>
              </div>
              <div className="flex space-x-2 ml-4">
                <button
                  type="button"
                  onClick={() => startEditing(index)}
                  className="px-2 py-1 text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => deleteTool(index)}
                  className="px-2 py-1 text-sm text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tools.length === 0 && !editingTool && (
        <p className="text-sm text-neutral-500 dark:text-neutral-300">
          No client-side tools defined. Click &quot;Add Tool&quot; to create
          one.
        </p>
      )}
    </div>
  );
};
