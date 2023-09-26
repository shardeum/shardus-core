Here is the interface to a class called VectorBufferStream that will read and write to a binary stream. You can assume the equivalent read functions exist that will read and return the value. Please write serialize and deserialize function for typescript type definitions that I will list in follow up chats. Note that the functions will pass in the stream object of type VectorBufferStream.
Each Type will result in two static functions serialize and deserialize. note these new functions will not be added to the type.

If our type is Foo this will mean we have serializeFoo and deserializeFoo. These static functions will not get added to the existing class. The serialize function will pass in the stream, the object, and an optional but default false boolean named topmost

Besides writing the actual data for the type if root is true, then also write out
the Int type that will be a constant that will represent our type. This constant
will start with "c" as a prefix to our type.
This constant will not be added to our type, it will be in global space

Also write an int version number const named c(TypeName)Version
this constant will also be in global space.

Arrays should write the count of items first before looping to write each item.

The deserialize function is the expected opposite of the serialize function
and will read from the binary stream and build the resulting object.
The deserialize function will have the arguments:
deserialize\*(stream:VectorBufferStream)
version will be read and used in the deserialize function to read the
data in different ways if the format has changed in a newer version (more on this below)

version and the optional type ID are both UInt16s

As you can tell, other then on the root this is a schema-less protocol

interface VectorBufferStream {
position: number;
getBuffer(): Buffer;
write(value: string | Buffer, encoding?: BufferEncoding): void;
writeInt8(value: number): void;
writeUInt8(value: number): void;
writeString(value: string): void;
writeBuffer(value: Buffer): void;
writeInt16(value: number): void;
writeUInt16(value: number): void;
writeInt32(value: number): void;
writeUInt32(value: number): void;
writeBigInt64(value: bigint): void;
writeBigUInt64(value: bigint): void;
writeFloat(value: number): void;
writeDouble(value: number): void;
readString(): string;
readBuffer(): Buffer;
readInt16(): number;
readUInt16(): number;
readInt32(): number;
readUInt32(): number;
readBigInt64(): bigint;
readBigUInt64(): bigint;
readFloat(): number;
readDouble(): number;
}

In requests after this I will posts types for you to please generate the above code.
If I post the same type twice increment the constant c(typename)Version by one
for any changes in the to schema make it so that branching code will read the correct
data from the stream. We will always simply write the newest version

Example:

```ts
export type Foo = {
  //io: int32
  accountID: number
  hash: string
}
```

Expected output:

```ts
let cFoo = 1
let cFooVersion = 1
export function serializeFoo(stream: VectorBufferStream, obj: Foo, root: boolean = false) {
  if (root) {
    stream.writeUInt16(cFoo)
  }
  stream.writeUInt16(cFooVersion)
  stream.writeString(obj.accountID)
  stream.write(obj.hash)
}

export function deserializeFoo(stream: VectorBufferStream): Foo {
  const version = stream.readUInt16()
  let accountID = stream.readInt32()
  let hash = stream.readString()
  let obj = {
    accountID,
    hash,
  }
  return obj
}
```

please also follow comments that start with //io:  
io comments will apply for the line below for either a type or a member of the type
this next means that when deserializing we throw an error if the array reports more than 15 entries
//io: max 15 entries read-checked
note that we would check this in the deserialize function and not something to hard code in a helper
function.

If you see the same type again, bump the version up but make sure deserialize can work for either version using conditionals. This will work by creating a if check for the specific version so that the function can
read or not read the correct amount of data from the stream. When a member is removed in version N+1 that existed
in version N we still need to read this value from the stream if reading a version N copy of the data.
On the other hand if version N+1 has some new data that version N did not have it will not be possible
to read this from the stream. Do not to make up values for newly added members if reading a new version
unless there is a "io:" comment with how to compute a default value. otherwise it should be set to undefined
io: default-for-deserialization: <someval> can be used to specify the value to load when reading an older
version of a given type.

If you see a type again and it is io tagged with io: no-version, please add to the generated code
throw new Error('<typeName> does not manage its own version. please re-version all types that use it')
<typeName> is a where the name of this type will be added.  
if you know the format of types that use it go ahead and bump the versions on them and update and pass
the parentVersion parameter(add if missing) to the non versioned type soe it can apply the correct
logic. in this case you do can add a comment to the error that says "parent types were updated,
but please verify before removing this error". Note that it is expected that this error would cause
the function to not proceed but this is so that code can be corrected and verified by a human.

serialization functions should generally just only write the latest
version of a type and not have branching. If the flag io: serialize-version-param is set please
add the optional param "version" that is set with a default that matches the current version.
conditionals inside the serialize\* function will allow writing different versions of the type.
If this type is flagged as io: no-version then call the "version" param "parentVersion"

Also if the type is flagged as io: no-version then add a parentVersion:number parameter to the deserialize\*
function of the type so that the parent version can control serialization.

enums backed by numbers are just saved as a number. the default is UInt16 unless specified in an io comment
remember to ignore comments that don't start with //IO:
conditional values should write a boolean to indicate if they are written to the
stream or not. This way the reader code can read the correct amount of data.
This boolean will be checked in an condition when the data is read.
For now this "boolean" will be written as a UInt8 and use 0 for false and 1 for true.

If you see a type used that you do not have a definition for yet go ahead and assume the correct
serialize and deserialize function exist for it based on the naming scheme.
If you see the type set operation or "|" then you need to encode what type is written
If you see the & operator need to create new functions to serialize and deserialize this new type
Use left to right ordering consistently so that types on the left are written first

//
this next section is for generating ajv schemas and registering them in an orderly way.

```ts
//example types used for schema generation:
export type Foo2 {
  someData: number
  someName: string
}
export type FooParent {
  someName: string
  arrayOfFoo: Foo2[]
}
```

ajv object schema verification:
Please also generate a verify\* function like verifyFooParent for each type you see.
When versions change these should be updated to verify only the latest version.

//there will ve a helper functions imported that will have these signatures:
export function addSchemaDependency(name:string, schema: object, requiredBy: string): void
export function addSchema(name: string, schema: object): void

Please generate:
schema\* for each type like schemaFoo2 this should be undefined by default.

also please generate the functions addSchemaDependencies() and addSchemas()
for each dependency call addSchema in the appropriate way
for each type call addSchema
it is ok to call addSchemaDependency multiple times for the same class as long as
the parent is different.

```ts
//This is an example of the function to generate:
export function addSchemaDependencies(): void {
  //all dependencies are added here (for types being worked on in this response)
  addSchemaDependency('Foo2', 'FooParent') //FooParent is the type that requires this
}

//This is an example of the function to generate:
export function addSchemas(): void {
  //register schemas here: (for types being worked on in this response)
  addSchema('Foo2', schemaFoo2) //here we register Foo2
  addSchema('FooParent', schemaFooParent) //here we register FooParent
}
```

you do not need to generate any output other than "ok" at the end of this first query. Follow up queries

Following this when you see a type pasted, please write the serialize and deserialize functions.
Also please generate the ajv schemas and register them per the addSchemaDependencies example

you do not need to generate a verify\* function or actually instantiate ajv, just handle the above mentioned
registration tasks for the schema.
please put all output in a single file.
remember you can just reply ok to this first statement, then provide generated code when types are listed in follow
up requests.
