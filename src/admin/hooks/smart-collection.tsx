import { useMutation, UseMutationOptions, useQueryClient, useQuery, UseQueryOptions } from "@tanstack/react-query";
import { sdk } from "../lib/sdk";
import { FetchError } from "@medusajs/js-sdk";
import {
	ConditionExpressionNode,
	Field,
	GroupExpressionNode,
	MatchType,
	Operator,
	Rule,
	RuleExpressionNode,
	SmartCollectionConditions,
	SmartCollectionMetadata,
	VALID_FIELDS,
	VALID_OPERATORS,
	createDefaultExpression,
	createDefaultRule,
	createDefaultRuleNode,
	resolveGroupOperator,
} from "../../lib/smart-collection";

export type {
	ConditionExpressionNode,
	Field,
	GroupExpressionNode,
	MatchType,
	Operator,
	Rule,
	RuleExpressionNode,
	SmartCollectionConditions,
	SmartCollectionMetadata,
};

export { createDefaultExpression, createDefaultRule, createDefaultRuleNode };

export type SmartCollectionSettingsResponse = {
	isLoading: boolean;
	isSmartCollection: boolean;
	smartCollectionConditions: SmartCollectionConditions;
	[key: string]: any;
};

// Unlike `normalizeRule` in lib, UI normalization keeps in-progress empty values so the user can edit them.
const normalizeRuleForUi = (rule?: Partial<Rule>): Rule => ({
	field: rule?.field && VALID_FIELDS.has(rule.field) ? rule.field : "title",
	operator: rule?.operator && VALID_OPERATORS.has(rule.operator) ? rule.operator : "starts_with",
	value: typeof rule?.value === "string" ? rule.value : "",
});

export const normalizeExpressionForUi = (node?: ConditionExpressionNode | null): GroupExpressionNode => {
	if (!node) {
		return createDefaultExpression();
	}

	if (node.kind === "rule") {
		return {
			kind: "group",
			operator: "all",
			children: [{ kind: "rule", rule: normalizeRuleForUi(node.rule) }],
		};
	}

	const operator = resolveGroupOperator(node);
	const children = node.children?.length
		? node.children.map((child) =>
				child.kind === "group"
					? normalizeExpressionForUi(child)
					: ({ kind: "rule" as const, rule: normalizeRuleForUi(child.rule) } satisfies RuleExpressionNode),
			)
		: [createDefaultRuleNode()];

	return { kind: "group", operator, children };
};

export const normalizeSmartCollectionConditions = (
	conditions?: SmartCollectionConditions | null,
): SmartCollectionConditions => ({
	expression: normalizeExpressionForUi(conditions?.expression),
});

export const useSmartCollectionSettings = (
	collectionId: string,
	options?: UseQueryOptions<SmartCollectionMetadata, FetchError, SmartCollectionMetadata, [string]>,
): SmartCollectionSettingsResponse => {
	const fetchSmartCollectionSettings = async () => {
		return await sdk.client.fetch<SmartCollectionMetadata>(`/admin/smart-collection/${collectionId}`);
	};

	const { data, ...rest } = useQuery<SmartCollectionMetadata, FetchError, SmartCollectionMetadata, [string]>({
		queryFn: fetchSmartCollectionSettings,
		queryKey: [`smart_collection_${collectionId}`],
		enabled: !!collectionId,
		...options,
	});

	return {
		isSmartCollection: data?.isSmartCollection || false,
		smartCollectionConditions: normalizeSmartCollectionConditions(data?.smartCollectionConditions),
		...rest,
	};
};

export const useSaveSmartCollectionSettings = (
	collectionId: string,
	options?: UseMutationOptions<any, FetchError, SmartCollectionMetadata>,
) => {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (settings: SmartCollectionMetadata) =>
			sdk.client.fetch(`/admin/smart-collection/${collectionId}`, {
				method: "post",
				body: settings,
				headers: {
					"Content-Type": "application/json",
				},
			}),
		onSuccess: (data: any, variables: any, context: any) => {
			queryClient.invalidateQueries({
				queryKey: [`smart_collection_${collectionId}`],
			});

			options?.onSuccess?.(data, variables, context);
		},
		...options,
	});
};

export const useTriggerSmartCollectionSync = (collectionId: string, options?: UseMutationOptions) => {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: () =>
			sdk.client.fetch(`/admin/smart-collection/${collectionId}/sync`, {
				method: "post",
			}),
		onSuccess: (data: any, variables: any, context: any) => {
			queryClient.invalidateQueries({
				queryKey: [`smart_collection_${collectionId}`],
			});

			options?.onSuccess?.(data, variables, context);
		},
		...options,
	});
};
