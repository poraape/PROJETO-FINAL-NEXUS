function createWeaviateMock() {
    const graphql = {
        get: jest.fn().mockReturnThis(),
        withClassName: jest.fn().mockReturnThis(),
        withFields: jest.fn().mockReturnThis(),
        withWhere: jest.fn().mockReturnThis(),
        withLimit: jest.fn().mockReturnThis(),
        do: jest.fn().mockResolvedValue({
            data: {
                Get: {
                    Documents: [
                        { fileName: 'doc-1', content: 'trecho relevante' },
                    ],
                },
            },
        }),
    };

    return {
        client: {
            graphql,
        },
        className: 'Documents',
    };
}

module.exports = {
    createWeaviateMock,
};
