import { Injectable, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { LocationService } from './location.service';
import { TermedService } from './termed.service';
import { BehaviorSubject, combineLatest, concat, merge, NEVER, Observable, Subject, Subscription, zip } from 'rxjs';
import { debounceTime, filter, flatMap, map, skip, switchMap, take } from 'rxjs/operators';
import { CollectionNode, ConceptNode, VocabularyNode } from 'app/entities/node';
import { comparingLocalizable } from 'yti-common-ui/utils/comparator';
import { LanguageService } from './language.service';
import { MetaModelService } from './meta-model.service';
import {
  Action,
  createEditAction,
  createNoSelection,
  createRemoveAction,
  createSelectAction,
  extractItem,
  isEdit,
  isRemove,
  isSelect
} from './action';
import { ElasticSearchService, IndexedConcept } from './elasticsearch.service';
import { assertNever } from 'yti-common-ui/utils/object';
import { contains, removeMatching, replaceMatching } from 'yti-common-ui/utils/array';
import { FormNode } from './form-state';
import { MetaModel } from 'app/entities/meta';
import { TranslateService } from '@ngx-translate/core';
import { PrefixAndNamespace } from 'app/entities/prefix-and-namespace';
import { HttpErrorResponse } from '@angular/common/http';
import { filterByPrefixPostfixSearch, splitSearchString } from 'yti-common-ui/utils/search';

function onlySelect<T>(action: Observable<Action<T>>): Observable<T> {
  return action.pipe(filter(isSelect), map(extractItem));
}

function onlyEdit<T>(action: Observable<Action<T>>): Observable<T> {
  return action.pipe(filter(isEdit), map(extractItem));
}

function onlyRemove<T>(action: Observable<Action<T>>): Observable<T> {
  return action.pipe(filter(isRemove), map(extractItem));
}

function updateOrRemoveItem<T extends { id: string }>(subject: BehaviorSubject<T[]>, id: string, newItem: T | null) {

  if (newItem) {
    return updateItem(subject, id, newItem);
  } else {
    return removeItem(subject, id);
  }
}

function updateItem<T extends { id: string }>(subject: BehaviorSubject<T[]>, id: string, newItem: T) {

  const previousCopy = subject.getValue().slice();

  if (replaceMatching(previousCopy, item => item.id === id, newItem)) {
    subject.next(previousCopy);
    return true;
  } else {
    return false;
  }
}

function removeItem<T extends { id: string }>(subject: BehaviorSubject<T[]>, id: string) {

  const previousCopy = subject.getValue().slice();

  if (removeMatching(previousCopy, item => item.id === id)) {
    subject.next(previousCopy);
    return true;
  } else {
    return false;
  }
}

export class ConceptListModel {

  search$ = new BehaviorSubject('');
  sortByTime$ = new BehaviorSubject<boolean>(false);
  onlyStatus$ = new BehaviorSubject<string | null>(null);
  searchResults$ = new BehaviorSubject<IndexedConcept[]>([]);
  searchTotalCount$ = new BehaviorSubject<number|undefined>(undefined);
  badSearchRequest$ = new BehaviorSubject<{ error: boolean, message?: string }>({ error: false });
  loading = false;

  private graphId: string;
  private initializing$ = new Subject<boolean>();

  private loaded = 0;
  private canLoadMore = true;

  private subscriptionToClean: Subscription[] = [];

  constructor(private elasticSearchService: ElasticSearchService,
              languageService: LanguageService) {

    const initialSearch = this.search$.pipe(take(1));
    const debouncedSearch = this.search$.pipe(skip(1), debounceTime(500));
    const search = concat(initialSearch, debouncedSearch);
    const conditionChange = combineLatest(search, this.sortByTime$, this.onlyStatus$, languageService.translateLanguage$);

    this.subscriptionToClean.push(
      this.initializing$.pipe(switchMap(initializing => initializing ? NEVER : conditionChange))
        .subscribe(() => this.loadConcepts(true))
    );
  }

  get searchResults() {
    return this.searchResults$.getValue();
  }

  get search() {
    return this.search$.getValue();
  }

  set search(value: string) {
    this.search$.next(value);
  }

  get sortByTime() {
    return this.sortByTime$.getValue();
  }

  set sortByTime(value: boolean) {
    this.sortByTime$.next(value);
  }

  get onlyStatus() {
    return this.onlyStatus$.getValue();
  }

  loadConcepts(reset = false) {

    const batchSize = 100;

    if (reset) {
      this.loaded = 0;
      this.canLoadMore = true;
    }

    if (this.canLoadMore) {

      this.loading = true;

      this.elasticSearchService.getAllConceptsForVocabularyWithMeta(this.graphId, this.search, this.sortByTime, this.onlyStatus, this.loaded, batchSize)
        .subscribe(meta => {
          this.clearBadSearchRequest();

          const concepts : IndexedConcept[] = meta.concepts;
          if (concepts.length < batchSize) {
            this.canLoadMore = false;
          }

          this.loaded += concepts.length;

          this.searchResults$.next(reset ? concepts : [...this.searchResults, ...concepts]);
          this.searchTotalCount$.next(meta.totalHitCount);
          this.loading = false;
        }, this.setBadSearchRequest.bind(this));
    }
  }

  refresh(conceptId: string, remove: boolean) {
    if (remove) {
      removeItem(this.searchResults$, conceptId);
    } else {
      this.elasticSearchService.findSingleConceptForVocabulary(this.graphId, conceptId, this.search, this.sortByTime, this.onlyStatus)
        .subscribe(indexedConcept => {
          this.clearBadSearchRequest();
          if (!updateOrRemoveItem(this.searchResults$, conceptId, indexedConcept)) {
            this.loadConcepts(true);
          }
        }, this.setBadSearchRequest.bind(this));
    }
  }

  initializeGraph(graphId: string, initialSearch?: string) {
    this.initializing$.next(true);
    this.graphId = graphId;
    this.search$.next(initialSearch ? initialSearch : '');
    this.sortByTime$.next(false);
    this.onlyStatus$.next(null);
    this.initializing$.next(false);
  }

  clean() {
    this.subscriptionToClean.forEach(s => s.unsubscribe());
  }

  private setBadSearchRequest(err: any) {
    this.loading = false;
    if (err instanceof HttpErrorResponse && err.status >= 400 && err.status < 500) {
      this.badSearchRequest$.next({ error: true, message: err.message });
      this.searchResults$.next([]);
    } else {
      console.error('Concept search failed: ' + JSON.stringify(err));
    }
    this.searchTotalCount$.next(undefined);
  }

  private clearBadSearchRequest() {
    if (this.badSearchRequest$.getValue().error) {
      this.badSearchRequest$.next({ error: false });
    }
  }
}

export class ConceptHierarchyModel {

  topConcepts$ = new BehaviorSubject<IndexedConcept[]>([]);
  nodes = new Map<string, { expanded: boolean, narrowerConcepts: BehaviorSubject<IndexedConcept[]> }>();
  loading = false;
  private initializing$ = new Subject<boolean>();

  private graphId: string;
  private loaded = 0;
  private canLoadMore = true;

  private subscriptionToClean: Subscription[] = [];

  constructor(private elasticSearchService: ElasticSearchService,
              languageService: LanguageService) {

    const conditionChange = combineLatest(languageService.translateLanguage$);

    this.subscriptionToClean.push(
      this.initializing$.pipe(switchMap(initializing => initializing ? NEVER : conditionChange))
        .subscribe(() => this.loadConcepts(true))
    );
  }

  get topConcepts() {
    return this.topConcepts$.getValue();
  }

  initializeGraph(graphId: string) {
    this.initializing$.next(true);
    this.graphId = graphId;
    this.loading = true;
    this.initializing$.next(false);
  }

  loadConcepts(reset = false) {

    const batchSize = 100;

    if (reset) {
      this.loaded = 0;
      this.canLoadMore = true;
      this.nodes.clear();
    }

    if (this.canLoadMore) {

      this.loading = true;

      this.elasticSearchService.getTopConceptsForVocabulary(this.graphId, this.loaded, batchSize)
        .subscribe(concepts => {
          if (concepts.length < batchSize) {
            this.canLoadMore = false;
          }

          this.loaded += concepts.length;

          this.topConcepts$.next(reset ? concepts : [...this.topConcepts, ...concepts]);
          this.loading = false;
        }, err => console.error("Loading top concepts failed: " + JSON.stringify(err)));
    }
  }

  refresh(conceptId: string, remove: boolean) {

    if (remove) {

      removeItem(this.topConcepts$, conceptId);

      for (const { narrowerConcepts } of Array.from(this.nodes.values())) {
        removeItem(narrowerConcepts, conceptId);
      }
    } else {

      this.elasticSearchService.findSingleConceptForVocabulary(this.graphId, conceptId, '', false, null)
        .subscribe(indexedConcept => {

          let updated = false;

          updated = updated || updateOrRemoveItem(this.topConcepts$, conceptId, indexedConcept);

          for (const { narrowerConcepts } of Array.from(this.nodes.values())) {
            updated = updated || updateOrRemoveItem(narrowerConcepts, conceptId, indexedConcept);
          }

          if (!updated) {
            this.loadConcepts(true);
          }
        }, err => console.error("Refreshing a concept failed: " + JSON.stringify(err)));
    }
  }

  getNarrowerConcepts(concept: IndexedConcept): Observable<IndexedConcept[]> {
    return this.nodes.get(concept.id)!.narrowerConcepts;
  }

  collapse(concept: IndexedConcept) {
    this.nodes.get(concept.id)!.expanded = false;
  }

  expand(concept: IndexedConcept) {

    if (!this.nodes.has(concept.id)) {
      const subject = new BehaviorSubject<IndexedConcept[]>([]);
      this.nodes.set(concept.id, { expanded: true, narrowerConcepts: subject });

      this.elasticSearchService.getNarrowerConcepts(concept.vocabulary.id, concept.id)
        .subscribe(concepts => subject.next(concepts),
          err => console.error("Getting narrower concepts failed: " + JSON.stringify(err)));
    } else {
      this.nodes.get(concept.id)!.expanded = true;
    }
  }

  isExpanded(concept: IndexedConcept) {
    const node = this.nodes.get(concept.id);
    return !!node && node.expanded;
  }

  clean() {
    this.subscriptionToClean.forEach(s => s.unsubscribe());
  }
}

export class CollectionListModel {

  search$ = new BehaviorSubject('');
  debouncedSearch$: Observable<string>;
  searchResults: Observable<CollectionNode[]>;
  allCollections$ = new BehaviorSubject<CollectionNode[]>([]);
  loading = false;
  graphId: string;

  constructor(private termedService: TermedService, private languageService: LanguageService) {

    const initialSearch$ = this.search$.pipe(take(1));
    const debouncedSearch$ = this.search$.pipe(skip(1), debounceTime(500));
    this.debouncedSearch$ = concat(initialSearch$, debouncedSearch$);

    this.searchResults = combineLatest(this.allCollections$, this.debouncedSearch$, languageService.translateLanguage$).pipe(map(([collections, search]) => {
      const searchParts = splitSearchString(search);
      if (searchParts) {
        return filterByPrefixPostfixSearch(collections, searchParts, c => c.label);
      }
      return collections;
    }));
  }

  initializeGraph(graphId: string) {

    this.graphId = graphId;
    this.loading = true;

    this.termedService.getCollectionList(graphId).subscribe(collections => {
      const sortedCollections = collections.sort(comparingLocalizable(this.languageService, collection => collection.label));
      this.allCollections$.next(sortedCollections);
      this.loading = false;
    });
  }

  refresh(collectionId: string, remove: boolean) {
    if (remove) {
      removeItem(this.allCollections$, collectionId);
    } else {
      this.termedService.getCollection(this.graphId, collectionId)
        .subscribe(collection => {
          if (!updateItem(this.allCollections$, collectionId, collection)) {
            this.initializeGraph(this.graphId);
          }
        });
    }
  }

  clean() {
    // nop for now
  }
}

@Injectable()
export class ConceptViewModelService implements OnDestroy {

  vocabularyForm: FormNode;
  vocabularyAction$ = new BehaviorSubject<Action<VocabularyNode>>(createNoSelection());
  vocabularySelect$ = onlySelect(this.vocabularyAction$);
  vocabularyEdit$ = onlyEdit(this.vocabularyAction$);
  vocabularyRemove$ = onlyRemove(this.vocabularyAction$);

  resourceForm: FormNode | null;
  resourceAction$ = new BehaviorSubject<Action<ConceptNode | CollectionNode>>(createNoSelection());
  resourceSelect$ = onlySelect(this.resourceAction$);
  resourceEdit$ = onlyEdit(this.resourceAction$);
  ressourceRemove$ = onlyRemove(this.resourceAction$);

  graphId: string;
  resourceId: string | null = null; // separate id besides selection item id is needed because selection is async loaded
  prefixAndNamespace: PrefixAndNamespace | null;

  conceptList = new ConceptListModel(this.elasticSearchService, this.languageService);
  conceptHierarchy = new ConceptHierarchyModel(this.elasticSearchService, this.languageService);
  collectionList = new CollectionListModel(this.termedService, this.languageService);

  loadingVocabulary = true;
  loadingResource = true;

  metaModel: Observable<MetaModel>;

  constructor(private router: Router,
              private termedService: TermedService,
              private elasticSearchService: ElasticSearchService,
              private metaModelService: MetaModelService,
              locationService: LocationService,
              private languageService: LanguageService,
              private translateService: TranslateService) {

    combineLatest(this.vocabularyAction$, this.resourceAction$)
      .subscribe(([vocabularyAction, resourceAction]: [Action<VocabularyNode>, Action<ConceptNode | CollectionNode>]) => {

        if (isSelect(vocabularyAction) || isEdit(vocabularyAction)) {
          if (isSelect(resourceAction) || isEdit(resourceAction)) {
            switch (resourceAction.item.type) {
              case 'Concept':
                locationService.atConcept(vocabularyAction.item, resourceAction.item);
                break;
              case 'Collection':
                locationService.atCollection(vocabularyAction.item, resourceAction.item);
                break;
              default:
                assertNever(resourceAction.item);
            }
          } else {
            locationService.atVocabulary(vocabularyAction.item);
          }
        }
      });

    this.resourceAction$.subscribe(action => {
      switch (action.type) {
        case 'edit':
        case 'remove':
          const remove = action.type === 'remove';

          if (action.item.type === 'Concept') {
            this.conceptList.refresh(action.item.id, remove);
            this.conceptHierarchy.refresh(action.item.id, remove);
          } else {
            this.collectionList.refresh(action.item.id, remove);
          }
      }
    });

    merge(this.vocabularySelect$, this.vocabularyEdit$).subscribe(vocabulary => {
      if (languageService.filterLanguage && !contains(vocabulary.languages, languageService.filterLanguage)) {
        languageService.filterLanguage = '';
      }
    });
  }

  get languages(): string[] {
    return this.vocabulary ? this.vocabulary.languages : [];
  }

  get vocabulary(): VocabularyNode | null {

    const action = this.vocabularyAction$.getValue();

    if (action.type === 'noselect' || action.type === 'remove') {
      return null;
    }

    return action.item;
  }

  get concept(): ConceptNode | null {

    const action = this.resourceAction$.getValue();

    if (action.type === 'noselect' || action.type === 'remove' || action.item.type !== 'Concept') {
      return null;
    }

    return action.item;
  }

  get collection(): CollectionNode | null {

    const action = this.resourceAction$.getValue();

    if (action.type === 'noselect' || action.type === 'remove' || action.item.type !== 'Collection') {
      return null;
    }

    return action.item;
  }

  get selection() {
    return this.concept || this.collection;
  }

  initializeVocabulary(graphId: string, initialConceptSearch?: string) {

    this.graphId = graphId;
    this.metaModel = this.metaModelService.getMeta(graphId);
    this.loadingVocabulary = true;

    this.conceptList.initializeGraph(graphId, initialConceptSearch);
    this.conceptHierarchy.initializeGraph(graphId);
    this.collectionList.initializeGraph(graphId);

    combineLatest(this.termedService.getVocabulary(graphId), this.metaModel)
      .subscribe(([vocabulary, metaModel]) => {
        this.vocabularyAction$.next(createSelectAction(vocabulary));
        this.vocabularyForm = new FormNode(vocabulary, () => vocabulary.languages, metaModel);
        this.loadingVocabulary = false;
      });

    this.termedService.getGraphNamespace(graphId).subscribe(graphNamespace => this.prefixAndNamespace = graphNamespace);
  }

  initializeConcept(conceptId: string) {

    const init = (concept: ConceptNode) => {
      this.metaModel.subscribe(metaModel => {
        this.resourceAction$.next(createSelectAction(concept));
        this.resourceForm = new FormNode(concept, () => this.languages, metaModel);
        this.loadingResource = false;
      });
    };

    this.loadingResource = true;
    this.resourceId = conceptId;

    this.termedService.findConcept(this.graphId, conceptId).subscribe(concept => {
      if (concept) {
        init(concept);
      } else {
        // XXX: Vocabulary might not be initialized yet
        // more robust waiting mechanism instead of duplicate fetch would be preferred
        this.termedService.getVocabulary(this.graphId).subscribe(vocabulary => {
          this.createEmptyConcept(vocabulary, conceptId).subscribe(init);
        });
      }
    });
  }

  initializeCollection(collectionId: string) {

    const init = (collection: CollectionNode) => {
      this.metaModel.subscribe(metaModel => {
        this.resourceAction$.next(createSelectAction(collection));
        this.resourceForm = new FormNode(collection, () => this.languages, metaModel);
        this.loadingResource = false;
      });
    };

    this.loadingResource = true;
    this.resourceId = collectionId;

    this.termedService.findCollection(this.graphId, collectionId).subscribe(collection => {
      if (collection) {
        init(collection);
      } else {
        // XXX: Vocabulary might not be initialized yet
        // more robust waiting mechanism instead of duplicate fetch would be preferred
        this.termedService.getVocabulary(this.graphId).subscribe(vocabulary => {
          this.createEmptyCollection(vocabulary, collectionId).subscribe(init);
        });
      }
    });
  }

  initializeNoSelection(selectFirstConcept: boolean) {

    this.resourceId = null;
    this.resourceAction$.next(createNoSelection());
    this.resourceForm = null;

    if (selectFirstConcept) {

      let searchResults$ = this.conceptList.searchResults$.asObservable();

      // XXX: when loading first search result is empty array initialization
      if (this.conceptList.loading) {
        searchResults$ = searchResults$.pipe(skip(1));
      }

      searchResults$.pipe(take(1)).subscribe(searchResults => {
        if (searchResults.length > 0) {
          const firstConcept = searchResults[0];
          this.router.navigate(['/concepts', firstConcept.vocabulary.id, 'concept', firstConcept.id], { skipLocationChange: true });
        }
      });
    }
  }

  saveConcept(confirmation?: (proposed: ConceptNode, previous: ConceptNode) => Promise<any>): Promise<any> {

    if (!this.concept || !this.resourceForm) {
      throw new Error('Cannot save when there is no concept');
    }

    const that = this;
    const concept = this.concept.clone();
    this.resourceForm.assignChanges(concept);

    const save = () => new Promise((resolve, reject) => {
      this.metaModel.subscribe(metaModel => {
        this.termedService.updateNode(concept, this.concept)
          .pipe(flatMap(() => this.termedService.getConcept(this.graphId, concept.id)))
          .subscribe({
            next(persistentConcept: ConceptNode) {
              that.resourceAction$.next(createEditAction(persistentConcept.clone()));
              that.resourceForm = new FormNode(persistentConcept, () => that.languages, metaModel);
              resolve();
            },
            error(err: any) {
              reject(err);
            }
          });
      });
    });

    if (confirmation) {
      return confirmation(concept, this.concept).then(save);
    } else {
      return save();
    }
  }

  removeConcept(): Promise<any> {
    if (!this.concept) {
      throw new Error('Cannot remove when there is no concept');
    }

    const that = this;
    const concept = this.concept;

    return new Promise((resolve, reject) => {
      this.termedService.removeNode(concept).subscribe({
        next() {
          that.resourceAction$.next(createRemoveAction(concept));
          that.router.navigate(['/concepts', that.graphId]);
          resolve();
        },
        error(err: any) {
          reject(err);
        }
      });
    });
  }

  resetConcept() {
    if (!this.concept) {
      throw new Error('Cannot reset when there is no concept');
    }

    if (!this.concept.persistent) {
      this.router.navigate(['/concepts', this.graphId]);
    } else {
      const concept = this.concept;
      this.metaModel.subscribe(metaModel => {
        this.resourceForm = new FormNode(concept, () => this.languages, metaModel);
      });
    }
  }

  saveCollection(): Promise<any> {

    if (!this.collection || !this.resourceForm) {
      throw new Error('Cannot save when there is no collection');
    }

    const that = this;
    const collection = this.collection.clone();
    this.resourceForm.assignChanges(collection);

    return new Promise((resolve, reject) => {

      this.metaModel.subscribe(metaModel => {
        this.termedService.updateNode(collection, this.collection)
          .pipe(flatMap(() => this.termedService.getCollection(this.graphId, collection.id)))
          .subscribe({
            next(persistentCollection: CollectionNode) {
              that.resourceAction$.next(createEditAction(persistentCollection.clone()));
              that.resourceForm = new FormNode(persistentCollection, () => that.languages, metaModel);
              resolve();
            },
            error(err: any) {
              reject(err);
            }
          });
      });
    });
  }

  removeCollection(): Promise<any> {
    if (!this.collection) {
      throw new Error('Cannot remove when there is no collection');
    }

    const that = this;
    const collection = this.collection;

    return new Promise((resolve, reject) => {
      this.termedService.removeNode(collection).subscribe({
        next() {
          that.resourceAction$.next(createRemoveAction(collection));
          that.router.navigate(['/concepts', that.graphId]);
          resolve();
        },
        error(err: any) {
          reject(err);
        }
      });
    });
  }

  resetCollection() {
    if (!this.collection) {
      throw new Error('Cannot reset when there is no collection');
    }

    if (!this.collection.persistent) {
      this.router.navigate(['/concepts', this.graphId]);
    } else {
      const collection = this.collection;
      this.metaModel.subscribe(metaModel => {
        this.resourceForm = new FormNode(collection, () => this.languages, metaModel);
      });
    }
  }

  saveVocabulary(): Promise<any> {

    if (!this.vocabulary) {
      throw new Error('Cannot save when there is no vocabulary');
    }

    const that = this;

    const vocabulary = this.vocabulary.clone();
    this.vocabularyForm.assignChanges(vocabulary);

    return new Promise((resolve, reject) => {

      this.metaModel.subscribe(metaModel => {
        this.termedService.updateNode(vocabulary, this.vocabulary)
          .pipe(flatMap(() => this.termedService.getVocabulary(this.graphId)))
          .subscribe({
            next(persistentVocabulary: VocabularyNode) {
              that.vocabularyAction$.next(createEditAction(persistentVocabulary.clone()));
              that.vocabularyForm = new FormNode(persistentVocabulary, () => that.languages, metaModel);
              resolve();
            },
            error(err: any) {
              reject(err);
            }
          });
      });
    });
  }

  removeVocabulary() {

    if (!this.vocabulary) {
      throw new Error('Cannot remove when there is no vocabulary');
    }

    const that = this;
    const vocabulary = this.vocabulary;

    return new Promise((resolve, reject) => {
      this.termedService.removeVocabulary(vocabulary.graphId).subscribe({
        next() {
          that.router.navigate(['/']);
          resolve();
        },
        error(err: any) {
          reject(err);
        }
      });
    });
  }

  resetVocabulary() {

    if (!this.vocabulary) {
      throw new Error('Cannot reset when there is no vocabulary');
    }

    const vocabulary = this.vocabulary;

    this.metaModel.subscribe(metaModel => {
      this.vocabularyForm = new FormNode(vocabulary, () => this.languages, metaModel);
    });
  }

  createEmptyConcept(vocabulary: VocabularyNode, nodeId: string): Observable<ConceptNode> {

    const label$ = this.translateService.get('New concept');

    return zip(label$, this.metaModel).pipe(map(([newConceptLabel, meta]) => {

      const newConcept = meta.createEmptyConcept(vocabulary, nodeId);
      newConcept.prefLabel = [{ lang: this.languageService.language, value: newConceptLabel }];
      return newConcept;
    }));
  }

  createEmptyCollection(vocabulary: VocabularyNode, nodeId: string): Observable<CollectionNode> {

    const label$ = this.translateService.get('New collection');

    return zip(label$, this.metaModel).pipe(map(([newCollectionLabel, meta]) => {
      const newCollection = meta.createEmptyCollection(vocabulary, nodeId);
      newCollection.prefLabel = [{ lang: this.languageService.language, value: newCollectionLabel }];
      return newCollection;
    }));
  }

  refreshConcepts() {
    this.conceptList.loadConcepts(true);
    this.conceptHierarchy.loadConcepts(true);
  }

  ngOnDestroy() {
    this.conceptList.clean();
    this.conceptHierarchy.clean();
    this.collectionList.clean();
  }
}
