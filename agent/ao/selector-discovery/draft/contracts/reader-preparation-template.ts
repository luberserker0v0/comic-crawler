import { ReaderPreparationCapability } from '../../base';

class ExampleReaderPreparationCapability extends ReaderPreparationCapability {
  getReaderContainerSelector(sourceUrl: string): string | undefined {
    return undefined;
  }

  getReaderPageSelector(sourceUrl: string): string | undefined {
    return undefined;
  }
}
