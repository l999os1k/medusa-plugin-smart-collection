import type { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import {
	ConditionExpressionNode,
	GroupExpressionNode,
	MatchType,
	Rule,
	normalizeExpressionNode,
	normalizeMatchType,
	normalizeRule,
} from "../lib/smart-collection";

type LegacyRuleGroup = {
	type?: MatchType;
	rules?: Rule[];
};

type LegacyRuleExpressionNode = {
	kind: "rule";
	connector?: MatchType;
	rule: Rule;
};

type LegacyGroupExpressionNode = {
	kind: "group";
	connector?: MatchType;
	type?: MatchType;
	operator?: MatchType;
	children?: LegacyExpressionNode[];
};

type LegacyExpressionNode = LegacyRuleExpressionNode | LegacyGroupExpressionNode;

type LegacySmartCollectionConditions = {
	type?: MatchType;
	rules?: Rule[];
	groups?: LegacyRuleGroup[];
	expression?: LegacyGroupExpressionNode | null;
};

type SmartCollectionMetadata = {
	isSmartCollection?: boolean;
	smartCollectionConditions?: LegacySmartCollectionConditions | null;
	[key: string]: unknown;
};

const PAGE_SIZE = 100;

const ruleToNode = (rule: Rule): ConditionExpressionNode | null => {
	const normalizedRule = normalizeRule(rule);
	return normalizedRule ? { kind: "rule", rule: normalizedRule } : null;
};

// Pick the group's operator from any of the legacy carriers, in priority order:
// new `operator` field → legacy `type` on the group → first child with a `connector` → default "all".
const operatorFromLegacyGroup = (group: LegacyGroupExpressionNode): MatchType => {
	if (group.operator) return normalizeMatchType(group.operator);
	if (group.type) return normalizeMatchType(group.type);
	const firstWithConnector = group.children?.find((child) => child?.connector);
	return normalizeMatchType(firstWithConnector?.connector);
};

const convertLegacyExpression = (node?: LegacyExpressionNode | null): ConditionExpressionNode | null => {
	if (!node) return null;

	if (node.kind === "rule") {
		return ruleToNode(node.rule);
	}

	const children = (node.children || [])
		.map(convertLegacyExpression)
		.filter((child): child is ConditionExpressionNode => Boolean(child));

	return children.length
		? {
				kind: "group",
				operator: operatorFromLegacyGroup(node),
				children,
			}
		: null;
};

const rulesToGroup = (type: MatchType, rules: Rule[] = []): GroupExpressionNode | null => {
	const children = rules.map(ruleToNode).filter((child): child is ConditionExpressionNode => Boolean(child));
	return children.length ? { kind: "group", operator: normalizeMatchType(type), children } : null;
};

const legacyConditionsToExpression = (
	conditions?: LegacySmartCollectionConditions | null,
): GroupExpressionNode | null => {
	const fromExpression = normalizeExpressionNode(convertLegacyExpression(conditions?.expression));
	if (fromExpression?.kind === "group") {
		return fromExpression;
	}

	if (conditions?.groups?.length) {
		const children = conditions.groups
			.map((group) => rulesToGroup(normalizeMatchType(group.type), group.rules || []))
			.filter((group): group is GroupExpressionNode => Boolean(group));

		return children.length ? { kind: "group", operator: normalizeMatchType(conditions.type), children } : null;
	}

	return rulesToGroup(normalizeMatchType(conditions?.type), conditions?.rules || []);
};

const hasLegacyConditionShape = (conditions?: LegacySmartCollectionConditions | null) =>
	Boolean(
		conditions &&
			("type" in conditions ||
				"rules" in conditions ||
				"groups" in conditions ||
				!("expression" in conditions) ||
				expressionHasLegacyShape(conditions.expression)),
	);

// Pre-`operator` data on the expression tree itself: a group with legacy `type` or a child carrying `connector`.
const expressionHasLegacyShape = (node?: LegacyExpressionNode | null): boolean => {
	if (!node || node.kind === "rule") {
		return Boolean(node && "connector" in node && node.connector);
	}

	if ("type" in node || (!node.operator && node.children?.some((child) => child?.connector))) {
		return true;
	}

	return Boolean(node.children?.some(expressionHasLegacyShape));
};

export default async function migrateSmartCollectionConditions({ container }: ExecArgs) {
	const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
	const productModule = container.resolve(Modules.PRODUCT) as any;
	const dryRun = process.argv.includes("dry-run") || process.argv.includes("--dry-run");

	const [, totalCount] = await productModule.listAndCountProductCollections();
	let scanned = 0;
	let updated = 0;
	let skipped = 0;

	for (let skip = 0; skip < totalCount; skip += PAGE_SIZE) {
		const collections = await productModule.listProductCollections(
			{},
			{
				take: PAGE_SIZE,
				skip,
			},
		);

		for (const collection of collections) {
			scanned += 1;

			const metadata = (collection.metadata || {}) as SmartCollectionMetadata;
			if (metadata.isSmartCollection === undefined && metadata.smartCollectionConditions === undefined) {
				skipped += 1;
				continue;
			}

			if (!hasLegacyConditionShape(metadata.smartCollectionConditions)) {
				skipped += 1;
				continue;
			}

			const expression = legacyConditionsToExpression(metadata.smartCollectionConditions);
			const nextMetadata = {
				...metadata,
				smartCollectionConditions: {
					expression,
				},
			};

			if (!dryRun) {
				await productModule.updateProductCollections(collection.id, {
					metadata: nextMetadata,
				});
			}

			updated += 1;
			logger.info(
				`[smart-collection-migrate] ${dryRun ? "would update" : "updated"} collection=${collection.id} expression=${expression ? "yes" : "null"}`,
			);
		}
	}

	logger.info(
		`[smart-collection-migrate] complete scanned=${scanned} updated=${updated} skipped=${skipped} dryRun=${dryRun}`,
	);
}
