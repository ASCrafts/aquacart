import ProductModel from './src/models/Product';

async function main() {
  console.log("ProductModel:", ProductModel);
  try {
    const queryObj = ProductModel.find({});
    console.log("find result:", queryObj);
    console.log("sort exists:", typeof queryObj.sort);
    console.log("lean exists:", typeof queryObj.lean);
  } catch (error) {
    console.error("Error running test:", error);
  }
}

main();
