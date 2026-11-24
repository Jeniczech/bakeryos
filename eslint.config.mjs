import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier/flat';

const eslintConfig = defineConfig([
    ...nextVitals,
    ...nextTs,
    prettier,
    {
        rules: {
            // Arrow functions only. Generators and class/object methods have no arrow equivalent.
            'no-restricted-syntax': [
                'error',
                {
                    selector: 'FunctionDeclaration:not([generator=true])',
                    message:
                        'Use an arrow function assigned to a const instead of a function declaration.',
                },
                {
                    selector:
                        "FunctionExpression:not([generator=true]):not(MethodDefinition > FunctionExpression):not(Property[method=true] > FunctionExpression):not(Property[kind!='init'] > FunctionExpression)",
                    message: 'Use an arrow function instead of a function expression.',
                },
            ],
        },
    },
    // Override default ignores of eslint-config-next.
    globalIgnores([
        // Default ignores of eslint-config-next:
        '.next/**',
        'out/**',
        'build/**',
        'next-env.d.ts',
    ]),
]);

export default eslintConfig;
