export type Operator = "equals" | "not_equals" | "contains" | "not_contains" | "starts_with" | "ends_with";

export type Field = "title" | "description" | "handle";
export type ConditionField = Field;

export type MatchType = "all" | "any";

export interface Rule {
	field: Field;
	value: string;
	operator: Operator;
}

export interface RuleExpressionNode {
	kind: "rule";
	rule: Rule;
}

export interface GroupExpressionNode {
	kind: "group";
	operator: MatchType;
	children: ConditionExpressionNode[];
}

export type ConditionExpressionNode = RuleExpressionNode | GroupExpressionNode;

export interface SmartCollectionConditions {
	expression: GroupExpressionNode | null;
}

export interface SmartCollectionMetadata {
	isSmartCollection: boolean;
	smartCollectionConditions: SmartCollectionConditions;
}

// Pre-`operator` data shape: groups had no operator and children carried a `connector`.
// Read paths accept this and lift connector → group operator via `resolveGroupOperator`.
export type LegacyChildShape = { kind?: "rule" | "group"; connector?: MatchType };

export const VALID_FIELDS = new Set<Field>(["title", "description", "handle"]);
export const VALID_OPERATORS = new Set<Operator>([
	"equals",
	"not_equals",
	"contains",
	"not_contains",
	"starts_with",
	"ends_with",
]);

export const normalizeMatchType = (type?: string): MatchType => (type === "any" ? "any" : "all");

export const resolveGroupOperator = (group: GroupExpressionNode): MatchType => {
	if (group.operator === "all" || group.operator === "any") {
		return group.operator;
	}

	const legacyChildren = (group.children || []) as Array<LegacyChildShape>;
	const firstWithConnector = legacyChildren.find((child) => child?.connector);
	return normalizeMatchType(firstWithConnector?.connector);
};

export const normalizeRule = (rule: Rule): Rule | null => {
	if (!rule || !VALID_FIELDS.has(rule.field) || !VALID_OPERATORS.has(rule.operator)) {
		return null;
	}

	const value = typeof rule.value === "string" ? rule.value.trim() : String(rule.value ?? "").trim();
	if (!value) {
		return null;
	}

	return {
		field: rule.field,
		operator: rule.operator,
		value,
	};
};

export const normalizeRules = (rules: Rule[] = []) =>
	rules.map(normalizeRule).filter((rule): rule is Rule => Boolean(rule));

export const normalizeExpressionNode = (node?: ConditionExpressionNode | null): ConditionExpressionNode | null => {
	if (!node) {
		return null;
	}

	if (node.kind === "rule") {
		const normalizedRule = normalizeRule(node.rule);
		return normalizedRule ? { kind: "rule", rule: normalizedRule } : null;
	}

	if (node.kind !== "group") {
		return null;
	}

	const operator = resolveGroupOperator(node);
	const children = (node.children || [])
		.map((child) => normalizeExpressionNode(child))
		.filter((child): child is ConditionExpressionNode => Boolean(child));

	return children.length
		? {
				kind: "group",
				operator,
				children,
			}
		: null;
};

export const normalizeConditionExpression = (
	conditions?: SmartCollectionConditions | null,
): GroupExpressionNode | null => {
	const expression = normalizeExpressionNode(conditions?.expression);
	return expression?.kind === "group" ? expression : null;
};

export const createDefaultRule = (): Rule => ({
	field: "title",
	operator: "starts_with",
	value: "",
});

export const createDefaultRuleNode = (): RuleExpressionNode => ({
	kind: "rule",
	rule: createDefaultRule(),
});

export const createDefaultExpression = (): GroupExpressionNode => ({
	kind: "group",
	operator: "all",
	children: [createDefaultRuleNode()],
});
