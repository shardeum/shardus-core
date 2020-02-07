declare const _exports: {
    [n: number]: string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    };
    length: number;
    toString(): string;
    toLocaleString(): string;
    pop(): string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    } | undefined;
    push(...items: (string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    })[]): number;
    concat(...items: ConcatArray<string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    }>[]): (string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    })[];
    concat(...items: (string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    } | ConcatArray<string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    }>)[]): (string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    })[];
    join(separator?: string | undefined): string;
    reverse(): (string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    })[];
    shift(): string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    } | undefined;
    slice(start?: number | undefined, end?: number | undefined): (string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    })[];
    sort(compareFn?: ((a: string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    }, b: string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    }) => number) | undefined): (string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    })[];
    splice(start: number, deleteCount?: number | undefined): (string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    })[];
    splice(start: number, deleteCount: number, ...items: (string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    })[]): (string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    })[];
    unshift(...items: (string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    })[]): number;
    indexOf(searchElement: string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    }, fromIndex?: number | undefined): number;
    lastIndexOf(searchElement: string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    }, fromIndex?: number | undefined): number;
    every(callbackfn: (value: string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    }, index: number, array: (string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    })[]) => unknown, thisArg?: any): boolean;
    some(callbackfn: (value: string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    }, index: number, array: (string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    })[]) => unknown, thisArg?: any): boolean;
    forEach(callbackfn: (value: string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    }, index: number, array: (string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    })[]) => void, thisArg?: any): void;
    map<U>(callbackfn: (value: string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    }, index: number, array: (string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    })[]) => U, thisArg?: any): U[];
    filter<S extends string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    }>(callbackfn: (value: string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    }, index: number, array: (string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    })[]) => value is S, thisArg?: any): S[];
    filter(callbackfn: (value: string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    }, index: number, array: (string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    })[]) => unknown, thisArg?: any): (string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    })[];
    reduce(callbackfn: (previousValue: string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    }, currentValue: string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    }, currentIndex: number, array: (string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    })[]) => string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    }): string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    };
    reduce(callbackfn: (previousValue: string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    }, currentValue: string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    }, currentIndex: number, array: (string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    })[]) => string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    }, initialValue: string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    }): string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    };
    reduce<U_1>(callbackfn: (previousValue: U_1, currentValue: string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    }, currentIndex: number, array: (string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    })[]) => U_1, initialValue: U_1): U_1;
    reduceRight(callbackfn: (previousValue: string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    }, currentValue: string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    }, currentIndex: number, array: (string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    })[]) => string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    }): string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    };
    reduceRight(callbackfn: (previousValue: string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    }, currentValue: string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    }, currentIndex: number, array: (string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    })[]) => string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    }, initialValue: string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    }): string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    };
    reduceRight<U_2>(callbackfn: (previousValue: U_2, currentValue: string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    }, currentIndex: number, array: (string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    })[]) => U_2, initialValue: U_2): U_2;
    find<S_1 extends string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    }>(predicate: (this: void, value: string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    }, index: number, obj: (string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    })[]) => value is S_1, thisArg?: any): S_1 | undefined;
    find(predicate: (value: string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    }, index: number, obj: (string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    })[]) => unknown, thisArg?: any): string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    } | undefined;
    findIndex(predicate: (value: string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    }, index: number, obj: (string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    })[]) => unknown, thisArg?: any): number;
    fill(value: string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    }, start?: number | undefined, end?: number | undefined): (string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    })[];
    copyWithin(target: number, start: number, end?: number | undefined): (string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    })[];
    [Symbol.iterator](): IterableIterator<string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    }>;
    entries(): IterableIterator<[number, string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    }]>;
    keys(): IterableIterator<number>;
    values(): IterableIterator<string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    }>;
    [Symbol.unscopables](): {
        copyWithin: boolean;
        entries: boolean;
        fill: boolean;
        find: boolean;
        findIndex: boolean;
        keys: boolean;
        values: boolean;
    };
    includes(searchElement: string | {
        key: {
            type: any;
            allowNull: boolean;
            primaryKey: boolean;
        };
        value: any;
    }, fromIndex?: number | undefined): boolean;
};
export = _exports;
