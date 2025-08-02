npx tsc --init
npm i -D typescript nodemon

tsconfig
outDir: ./dist
rootDir: ./src
"noImplicitAny": true,                            /* Enable error reporting for expressions and declarations with an implied 'any' type. */
"strictNullChecks": true,                         /* When type checking, take into account 'null' and 'undefined'. */
    "strictFunctionTypes": true, 