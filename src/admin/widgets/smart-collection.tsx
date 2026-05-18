import { defineWidgetConfig } from "@medusajs/admin-sdk";
import { DetailWidgetProps } from "@medusajs/types";
import { Button, Container, Text, Select, Switch, toast, Input, IconButton } from "@medusajs/ui";
import { Plus, Trash } from "@medusajs/icons";
import { useState, useEffect, useCallback } from "react";
import {
	useSmartCollectionSettings,
	useSaveSmartCollectionSettings,
	SmartCollectionMetadata,
	Rule,
	Operator,
	Field,
	MatchType,
	GroupExpressionNode,
	ConditionExpressionNode,
	createDefaultRuleNode,
	createDefaultExpression,
	normalizeSmartCollectionConditions,
} from "../hooks/smart-collection";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "../lib/query-client";

const FIELD_OPTIONS: ReadonlyArray<{ value: Field; label: string }> = [
	{ value: "title", label: "Title" },
	{ value: "description", label: "Description" },
	{ value: "handle", label: "Handle" },
];

const OPERATOR_OPTIONS: ReadonlyArray<{ value: Operator; label: string }> = [
	{ value: "equals", label: "equals" },
	{ value: "not_equals", label: "does not equal" },
	{ value: "contains", label: "contains" },
	{ value: "not_contains", label: "does not contain" },
	{ value: "starts_with", label: "starts with" },
	{ value: "ends_with", label: "ends with" },
];

const MATCH_OPTIONS: ReadonlyArray<{ value: MatchType; label: string }> = [
	{ value: "all", label: "All" },
	{ value: "any", label: "Any" },
];

const getExpression = (settings: SmartCollectionMetadata): GroupExpressionNode =>
	settings.smartCollectionConditions?.expression ?? createDefaultExpression();

const expressionHasEmptyValues = (node: ConditionExpressionNode): boolean => {
	if (node.kind === "rule") {
		return !node.rule.value.trim();
	}

	return node.children.some(expressionHasEmptyValues);
};

const expressionHasNoRules = (node: ConditionExpressionNode): boolean => {
	if (node.kind === "rule") {
		return false;
	}

	return !node.children.length || node.children.every(expressionHasNoRules);
};

const updateGroupAtPath = (
	group: GroupExpressionNode,
	path: number[],
	updater: (group: GroupExpressionNode) => GroupExpressionNode,
): GroupExpressionNode => {
	if (!path.length) {
		return updater(group);
	}

	const [index, ...rest] = path;
	return {
		...group,
		children: group.children.map((child, childIndex) => {
			if (childIndex !== index || child.kind !== "group") {
				return child;
			}

			return updateGroupAtPath(child, rest, updater);
		}),
	};
};

const updateNodeAtPath = (
	group: GroupExpressionNode,
	path: number[],
	updater: (node: ConditionExpressionNode) => ConditionExpressionNode,
): GroupExpressionNode => {
	if (path.length === 1) {
		const targetIndex = path[0];
		return {
			...group,
			children: group.children.map((child, index) => (index === targetIndex ? updater(child) : child)),
		};
	}

	const [index, ...rest] = path;
	return {
		...group,
		children: group.children.map((child, childIndex) => {
			if (childIndex !== index || child.kind !== "group") {
				return child;
			}

			return updateNodeAtPath(child, rest, updater);
		}),
	};
};

const removeNodeAtPath = (group: GroupExpressionNode, path: number[]): GroupExpressionNode => {
	if (path.length === 1) {
		const targetIndex = path[0];
		return {
			...group,
			children: group.children.filter((_, index) => index !== targetIndex),
		};
	}

	const [index, ...rest] = path;
	return {
		...group,
		children: group.children.map((child, childIndex) => {
			if (childIndex !== index || child.kind !== "group") {
				return child;
			}

			return removeNodeAtPath(child, rest);
		}),
	};
};

const ConditionItem = ({
	rule,
	onUpdate,
	onDelete,
	showDeleteButton,
}: {
	rule: Rule;
	onUpdate: (rule: Rule) => void;
	onDelete: () => void;
	showDeleteButton: boolean;
}) => (
	<div className="flex gap-x-2 items-center">
		<div className="flex-1">
			<Select value={rule.field} onValueChange={(value) => onUpdate({ ...rule, field: value as Field })} size="small">
				<Select.Trigger>
					<Select.Value placeholder="Select field" />
				</Select.Trigger>
				<Select.Content>
					{FIELD_OPTIONS.map((option) => (
						<Select.Item key={option.value} value={option.value}>
							{option.label}
						</Select.Item>
					))}
				</Select.Content>
			</Select>
		</div>
		<div className="flex-1">
			<Select
				value={rule.operator}
				onValueChange={(value) => onUpdate({ ...rule, operator: value as Operator })}
				size="small"
			>
				<Select.Trigger>
					<Select.Value placeholder="Select operator" />
				</Select.Trigger>
				<Select.Content>
					{OPERATOR_OPTIONS.map((option) => (
						<Select.Item key={option.value} value={option.value}>
							{option.label}
						</Select.Item>
					))}
				</Select.Content>
			</Select>
		</div>
		<div className="flex-1">
			<Input
				type="text"
				value={rule.value}
				onChange={(e) => onUpdate({ ...rule, value: e.target.value })}
				size="small"
				placeholder="Enter value"
			/>
		</div>
		{showDeleteButton && (
			<IconButton variant="transparent" size="small" type="button" onClick={onDelete}>
				<Trash className="text-ui-fg-subtle" />
			</IconButton>
		)}
	</div>
);

const OperatorPill = ({ value, onChange }: { value: MatchType; onChange: (value: MatchType) => void }) => (
	<div className="w-[92px] shrink-0">
		<Select value={value} onValueChange={(value) => onChange(value as MatchType)} size="small">
			<Select.Trigger>
				<Select.Value />
			</Select.Trigger>
			<Select.Content>
				{MATCH_OPTIONS.map((option) => (
					<Select.Item key={option.value} value={option.value}>
						{option.label}
					</Select.Item>
				))}
			</Select.Content>
		</Select>
	</div>
);

const ExpressionGroupEditor = ({
	group,
	path,
	onUpdateGroup,
	onUpdateNode,
	onRemoveNode,
	onRemoveGroup,
	canRemove,
}: {
	group: GroupExpressionNode;
	path: number[];
	onUpdateGroup: (path: number[], updater: (group: GroupExpressionNode) => GroupExpressionNode) => void;
	onUpdateNode: (path: number[], updater: (node: ConditionExpressionNode) => ConditionExpressionNode) => void;
	onRemoveNode: (path: number[]) => void;
	onRemoveGroup?: () => void;
	canRemove: boolean;
}) => {
	const isRoot = path.length === 0;

	const handleAddRule = () => {
		onUpdateGroup(path, (currentGroup) => ({
			...currentGroup,
			children: [...currentGroup.children, createDefaultRuleNode()],
		}));
	};

	const handleAddGroup = () => {
		onUpdateGroup(path, (currentGroup) => ({
			...currentGroup,
			children: [...currentGroup.children, createDefaultExpression()],
		}));
	};

	const handleOperatorChange = (operator: MatchType) => {
		onUpdateGroup(path, (currentGroup) => ({ ...currentGroup, operator }));
	};

	const canRemoveChild = !isRoot || group.children.length > 1;

	return (
		<div className={isRoot ? "" : "border border-ui-border-base rounded-lg p-4 bg-ui-bg-subtle"}>
			<div className="flex items-center justify-between mb-3">
				<div className="flex items-center gap-x-2">
					<Text size="small" className="text-ui-fg-subtle">
						Match
					</Text>
					<OperatorPill value={group.operator} onChange={handleOperatorChange} />
					<Text size="small" className="text-ui-fg-subtle">
						of the following
					</Text>
				</div>
				{canRemove && onRemoveGroup && (
					<IconButton variant="transparent" size="small" type="button" onClick={onRemoveGroup}>
						<Trash className="text-ui-fg-subtle" />
					</IconButton>
				)}
			</div>

			<div className="space-y-2">
				{group.children.map((child, index) => {
					const childPath = [...path, index];

					return (
						<div key={childPath.join("-")}>
							{child.kind === "group" ? (
								<ExpressionGroupEditor
									group={child}
									path={childPath}
									onUpdateGroup={onUpdateGroup}
									onUpdateNode={onUpdateNode}
									onRemoveNode={onRemoveNode}
									onRemoveGroup={() => onRemoveNode(childPath)}
									canRemove
								/>
							) : (
								<ConditionItem
									rule={child.rule}
									onUpdate={(rule) => onUpdateNode(childPath, () => ({ kind: "rule", rule }))}
									onDelete={() => onRemoveNode(childPath)}
									showDeleteButton={canRemoveChild}
								/>
							)}
						</div>
					);
				})}
			</div>

			<div className="flex gap-x-2 mt-3">
				<Button variant="secondary" size="small" onClick={handleAddRule}>
					<Plus className="mr-2" />
					Add condition
				</Button>
				<Button variant="secondary" size="small" onClick={handleAddGroup}>
					<Plus className="mr-2" />
					Add group
				</Button>
			</div>
		</div>
	);
};

// Main Smart Collection Widget component
const SmartCollectionWidget = ({ data }: DetailWidgetProps<any>) => {
	const [settings, setSettings] = useState<SmartCollectionMetadata>({
		isSmartCollection: false,
		smartCollectionConditions: {
			expression: null,
		},
	});

	const collectionId = data?.id;

	// 使用 hooks 獲取智能收藏集設置
	const { isLoading, isSmartCollection, smartCollectionConditions, dataUpdatedAt } =
		useSmartCollectionSettings(collectionId);

	const [lastSyncedDataUpdatedAt, setLastSyncedDataUpdatedAt] = useState(0);

	useEffect(() => {
		if (!dataUpdatedAt || dataUpdatedAt === lastSyncedDataUpdatedAt) {
			return;
		}

		setSettings({
			isSmartCollection,
			smartCollectionConditions: normalizeSmartCollectionConditions(smartCollectionConditions),
		});
		setLastSyncedDataUpdatedAt(dataUpdatedAt);
	}, [dataUpdatedAt, isSmartCollection, smartCollectionConditions, lastSyncedDataUpdatedAt]);

	// 使用 hooks 保存智能收藏集設置
	const { mutate: saveSettings, isPending: isSaving } = useSaveSmartCollectionSettings(collectionId, {
		onSuccess: (data: any) => {
			toast.success(`${data.message || "Settings saved successfully"}`);
		},
		onError: (error: Error) => {
			toast.error(`${error.message || "Failed to save settings"}`);
		},
	});

	// `settings` always holds an expression normalized at load time (see useEffect above), so we
	// don't re-normalize on every keystroke. Save-time validation runs in handleSave.
	const updateExpression = (updater: (expression: GroupExpressionNode) => GroupExpressionNode) => {
		setSettings((prev) => ({
			...prev,
			smartCollectionConditions: {
				expression: updater(getExpression(prev)),
			},
		}));
	};

	const handleUpdateGroup = (path: number[], updater: (group: GroupExpressionNode) => GroupExpressionNode) => {
		updateExpression((expression) => updateGroupAtPath(expression, path, updater));
	};

	const handleUpdateNode = (path: number[], updater: (node: ConditionExpressionNode) => ConditionExpressionNode) => {
		updateExpression((expression) => updateNodeAtPath(expression, path, updater));
	};

	const handleRemoveNode = (path: number[]) => {
		updateExpression((expression) => removeNodeAtPath(expression, path));
	};

	// 將 handleSave 包裝成 useCallback 以便在其他函數中使用
	const handleSave = useCallback(() => {
		const expression = getExpression(settings);
		const normalizedSettings = {
			...settings,
			smartCollectionConditions: {
				expression,
			},
		};

		if (settings.isSmartCollection && expressionHasNoRules(expression)) {
			toast.error("Add at least one condition before saving");
			return;
		}

		if (settings.isSmartCollection && expressionHasEmptyValues(expression)) {
			toast.error("Fill in all condition values before saving");
			return;
		}

		saveSettings(normalizedSettings);
	}, [saveSettings, settings]);

	const handleToggleSmartCollection = (enabled: boolean) => {
		if (enabled === settings.isSmartCollection) {
			return;
		}

		if (enabled) {
			// 打開 Smart Collection 時，只更新本地狀態，不立即保存
			setSettings((prev) => {
				const expression = getExpression(prev);

				return {
					...prev,
					isSmartCollection: true,
					smartCollectionConditions: {
						expression,
					},
				};
			});
		} else {
			// 關閉 Smart Collection 時，只將 isSmartCollection 改為 false，保留 smartCollectionConditions 的內容
			const newSettings: SmartCollectionMetadata = {
				isSmartCollection: false,
				smartCollectionConditions: settings.smartCollectionConditions,
			};

			// 更新本地狀態
			setSettings(newSettings);

			// 立即保存到服務器
			saveSettings(newSettings);
			toast.success("Smart Collection has been disabled");
		}
	};

	if (!collectionId || isLoading) {
		return null;
	}

	const expression = getExpression(settings);

	return (
		<Container>
			<div className="mb-8">
				<div className="flex items-center justify-between mb-4">
					<Text className="font-sans font-medium h2-core">Smart Collection</Text>
					<Switch checked={settings.isSmartCollection} onCheckedChange={handleToggleSmartCollection} />
				</div>
			</div>

			{settings.isSmartCollection && (
				<>
					<ExpressionGroupEditor
						group={expression}
						path={[]}
						onUpdateGroup={handleUpdateGroup}
						onUpdateNode={handleUpdateNode}
						onRemoveNode={handleRemoveNode}
						canRemove={false}
					/>

					<div className="flex justify-end gap-x-2 mt-8">
						<Button variant="secondary" onClick={() => window.history.back()}>
							Cancel
						</Button>
						<Button variant="primary" onClick={handleSave} disabled={isSaving} isLoading={isSaving}>
							{isSaving ? "Saving..." : "Save and Apply"}
						</Button>
					</div>
				</>
			)}
		</Container>
	);
};

// Widget configuration
export const config = defineWidgetConfig({
	zone: "product_collection.details.after",
});

const WrappedSmartCollectionWidget = (props: DetailWidgetProps<any>) => (
	<QueryClientProvider client={queryClient}>
		<SmartCollectionWidget {...props} />
	</QueryClientProvider>
);

export default WrappedSmartCollectionWidget;
