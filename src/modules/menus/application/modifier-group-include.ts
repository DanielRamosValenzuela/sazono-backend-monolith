const optionsOrder = { sortOrder: 'asc' as const };
const groupsOrder = [{ sortOrder: 'asc' as const }, { name: 'asc' as const }];

const leafGroup = { options: { orderBy: optionsOrder } };

const midGroup = {
  options: {
    orderBy: optionsOrder,
    include: { childGroups: { orderBy: groupsOrder, include: leafGroup } },
  },
};

export const MODIFIER_GROUP_TREE_INCLUDE = {
  options: {
    orderBy: optionsOrder,
    include: { childGroups: { orderBy: groupsOrder, include: midGroup } },
  },
};

export const MODIFIER_GROUP_ANCESTRY_INCLUDE = {
  parentOption: {
    include: {
      modifierGroup: {
        include: {
          parentOption: {
            include: {
              modifierGroup: {
                include: {
                  parentOption: { include: { modifierGroup: true } },
                },
              },
            },
          },
        },
      },
    },
  },
};
