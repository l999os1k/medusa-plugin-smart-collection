import type { Logger } from "@medusajs/framework/types";
import {
	ConditionExpressionNode,
	ConditionField,
	GroupExpressionNode,
	MatchType,
	Operator,
	Rule,
	RuleExpressionNode,
	SmartCollectionConditions,
	SmartCollectionMetadata,
	normalizeConditionExpression,
	normalizeExpressionNode,
	normalizeRule,
	normalizeRules,
} from "../../lib/smart-collection";

export type {
	ConditionExpressionNode,
	ConditionField,
	GroupExpressionNode,
	MatchType,
	Operator,
	Rule,
	RuleExpressionNode,
	SmartCollectionConditions,
	SmartCollectionMetadata,
};

export { normalizeConditionExpression, normalizeExpressionNode, normalizeRule, normalizeRules };

type SmartCollectionProduct = {
	id?: string;
	title?: unknown;
	description?: unknown;
	handle?: unknown;
};

type InjectedDependencies = {
	logger: Logger;
};

class SmartCollectionService {
	private logger: Logger;

	constructor({ logger }: InjectedDependencies) {
		this.logger = logger;
		this.logger.info("SmartCollection module initialized");
	}

	public evaluateCondition(product: SmartCollectionProduct, rule: Rule): boolean {
		const normalizedRule = normalizeRule(rule);

		if (!normalizedRule) {
			return false;
		}

		const { field, operator, value } = normalizedRule;

		if (product[field] === undefined || product[field] === null) {
			this.logger.debug(`Product ${product.id} doesn't have field ${field}`);
			return false;
		}

		const fieldValue = product[field].toString().toLowerCase();
		const valueToCompare = value.toString().toLowerCase();

		switch (operator) {
			case "equals":
				return fieldValue === valueToCompare;
			case "not_equals":
				return fieldValue !== valueToCompare;
			case "contains":
				return fieldValue.includes(valueToCompare);
			case "not_contains":
				return !fieldValue.includes(valueToCompare);
			case "starts_with":
				return fieldValue.startsWith(valueToCompare);
			case "ends_with":
				return fieldValue.endsWith(valueToCompare);
			default:
				return false;
		}
	}

	// Assumes `node` is already normalized — callers must normalize once at the boundary.
	private evaluateNormalized(product: SmartCollectionProduct, node: ConditionExpressionNode): boolean {
		if (node.kind === "rule") {
			return this.evaluateCondition(product, node.rule);
		}

		if (!node.children.length) {
			return false;
		}

		return node.operator === "any"
			? node.children.some((child) => this.evaluateNormalized(product, child))
			: node.children.every((child) => this.evaluateNormalized(product, child));
	}

	public evaluateExpression(product: SmartCollectionProduct, node: ConditionExpressionNode): boolean {
		const normalizedNode = normalizeExpressionNode(node);
		return normalizedNode ? this.evaluateNormalized(product, normalizedNode) : false;
	}

	public evaluateConditions(product: SmartCollectionProduct, conditions?: SmartCollectionConditions | null): boolean {
		const expression = normalizeConditionExpression(conditions);
		return expression ? this.evaluateNormalized(product, expression) : false;
	}
}

export default SmartCollectionService;
