export type ImpactLevel = 'low' | 'medium' | 'high';
export type ResourceType = 'cpu' | 'memory' | 'network' | 'battery' | 'injection';

export interface ResourceImpact {
	level: ImpactLevel;
	types: ResourceType[];
	descriptionKey: string;
}

export interface MonitoredService {
	id: string;
	active: boolean;
	toolType: 'script' | 'service';
	impact: ResourceImpact;
}
