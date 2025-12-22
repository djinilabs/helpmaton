import { useState, useRef } from "react";
import type { FC } from "react";

export interface ParameterSchema {
  type: "string" | "number" | "boolean" | "object" | "array";
  description?: string;
  properties?: Record<string, ParameterSchema>;
  items?: ParameterSchema;
  required?: string[];
}

interface ParameterBuilderProps {
  schema: ParameterSchema;
  onChange: (schema: ParameterSchema) => void;
}

export const ClientToolParameterBuilder: FC<ParameterBuilderProps> = ({
  schema,
  onChange,
}) => {
  const [editingKeys, setEditingKeys] = useState<Record<string, string>>({});
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const updateSchema = (updates: Partial<ParameterSchema>) => {
    onChange({ ...schema, ...updates });
  };

  // Handle property key rename
  const handleKeyRename = (oldKey: string, newKey: string) => {
    if (!newKey || newKey === oldKey) {
      // Cancel editing if empty or unchanged
      setEditingKeys((prev) => {
        const next = { ...prev };
        delete next[oldKey];
        return next;
      });
      return;
    }

    // Check if new key already exists
    if (schema.properties && schema.properties[newKey]) {
      alert(`Property "${newKey}" already exists`);
      setEditingKeys((prev) => {
        const next = { ...prev };
        delete next[oldKey];
        return next;
      });
      return;
    }

    // Perform the rename
    if (schema.properties) {
      const newProperties = { ...schema.properties };
      const propSchema = newProperties[oldKey];
      delete newProperties[oldKey];
      newProperties[newKey] = propSchema;

      const newRequired = (schema.required || []).map((r) =>
        r === oldKey ? newKey : r
      );

      updateSchema({
        properties: newProperties,
        required: newRequired.length > 0 ? newRequired : undefined,
      });
    }

    // Clear editing state
    setEditingKeys((prev) => {
      const next = { ...prev };
      delete next[oldKey];
      return next;
    });
  };

  // Start editing a key
  const startEditingKey = (key: string) => {
    setEditingKeys((prev) => ({ ...prev, [key]: key }));
    // Focus the input after state update
    setTimeout(() => {
      inputRefs.current[key]?.focus();
      inputRefs.current[key]?.select();
    }, 0);
  };

  if (schema.type === "object") {
    return (
      <div className="ml-2 space-y-4 border-l-2 border-neutral-300 pl-4">
        <div className="space-y-2">
          <label className="block text-sm font-medium text-neutral-700">
            Properties
          </label>
          {schema.properties &&
            Object.entries(schema.properties).map(([key, propSchema]) => {
              const isEditing = editingKeys[key] !== undefined;
              const displayKey = isEditing ? editingKeys[key] : key;

              return (
                <div
                  key={key} // Use original key for stable identity
                  className="space-y-2 rounded border border-neutral-200 p-3"
                >
                  <div className="flex items-center justify-between">
                    {isEditing ? (
                      <input
                        ref={(el) => {
                          inputRefs.current[key] = el;
                        }}
                        type="text"
                        value={displayKey}
                        onChange={(e) => {
                          setEditingKeys((prev) => ({
                            ...prev,
                            [key]: e.target.value,
                          }));
                        }}
                        onBlur={() => {
                          handleKeyRename(key, displayKey);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleKeyRename(key, displayKey);
                          } else if (e.key === "Escape") {
                            e.preventDefault();
                            setEditingKeys((prev) => {
                              const next = { ...prev };
                              delete next[key];
                              return next;
                            });
                          }
                        }}
                        className="flex-1 rounded border border-neutral-300 px-2 py-1 text-sm font-medium"
                        placeholder="Property name"
                        autoFocus
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => startEditingKey(key)}
                        className="flex-1 rounded border border-neutral-300 px-2 py-1 text-left text-sm font-medium hover:bg-neutral-50"
                      >
                        {key}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        const newProperties = { ...schema.properties };
                        delete newProperties[key];
                        const newRequired = (schema.required || []).filter(
                          (r) => r !== key
                        );
                        updateSchema({
                          properties: newProperties,
                          required:
                            newRequired.length > 0 ? newRequired : undefined,
                        });
                      }}
                      className="ml-2 text-sm text-red-600 hover:text-red-800"
                    >
                      Remove
                    </button>
                  </div>
                  <ClientToolParameterBuilder
                    schema={propSchema}
                    onChange={(updated) => {
                      const newProperties = {
                        ...schema.properties,
                        [key]: updated,
                      };
                      updateSchema({ properties: newProperties });
                    }}
                  />
                  <label className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={(schema.required || []).includes(key)}
                      onChange={(e) => {
                        const currentRequired = schema.required || [];
                        if (e.target.checked) {
                          updateSchema({
                            required: [...currentRequired, key],
                          });
                        } else {
                          updateSchema({
                            required: currentRequired.filter((r) => r !== key),
                          });
                        }
                      }}
                      className="rounded"
                    />
                    <span className="text-xs text-neutral-600">Required</span>
                  </label>
                </div>
              );
            })}
          <button
            type="button"
            onClick={() => {
              const newKey = `property${
                Object.keys(schema.properties || {}).length + 1
              }`;
              const newProperties = {
                ...(schema.properties || {}),
                [newKey]: { type: "string" as const },
              };
              updateSchema({ properties: newProperties });
            }}
            className="rounded border border-blue-300 px-2 py-1 text-sm text-blue-600 hover:text-blue-800"
          >
            + Add Property
          </button>
        </div>
      </div>
    );
  }

  if (schema.type === "array") {
    return (
      <div className="ml-2 space-y-2 border-l-2 border-neutral-300 pl-4">
        <label className="block text-sm font-medium text-neutral-700">
          Array Items
        </label>
        {schema.items ? (
          <ClientToolParameterBuilder
            schema={schema.items}
            onChange={(updated) => {
              updateSchema({ items: updated });
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              updateSchema({ items: { type: "string" } });
            }}
            className="rounded border border-blue-300 px-2 py-1 text-sm text-blue-600 hover:text-blue-800"
          >
            + Define Item Schema
          </button>
        )}
      </div>
    );
  }

  // Primitive types (string, number, boolean)
  return (
    <div className="space-y-2">
      <div className="flex items-center space-x-2">
        <select
          value={schema.type}
          onChange={(e) => {
            const newType = e.target.value as ParameterSchema["type"];
            if (newType === "object") {
              updateSchema({
                type: newType,
                properties: {},
                required: [],
              });
            } else if (newType === "array") {
              updateSchema({
                type: newType,
                items: { type: "string" },
              });
            } else {
              updateSchema({ type: newType });
            }
          }}
          className="rounded border border-neutral-300 px-2 py-1 text-sm"
        >
          <option value="string">String</option>
          <option value="number">Number</option>
          <option value="boolean">Boolean</option>
          <option value="object">Object</option>
          <option value="array">Array</option>
        </select>
      </div>
      <textarea
        value={schema.description || ""}
        onChange={(e) => {
          updateSchema({
            description: e.target.value || undefined,
          });
        }}
        placeholder="Description (optional)"
        className="w-full rounded border border-neutral-300 px-2 py-1 text-sm"
        rows={2}
      />
    </div>
  );
};
