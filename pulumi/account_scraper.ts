import * as AWS from 'aws-sdk';
import * as stringcase from 'stringcase';
import * as util from 'util';

const ec2Client = new AWS.EC2();

type Resource = {
  type: string,
  name: string,
  id: string,
};

function generateImportResources(
  getAwsResources: () => any[],
  getResourceId: (resource: any) => string,
  pulumiTypeIdentifier: string,
): Resource[] {
  const pulumiResources: Resource[] = [];
  for (const awsResource of getAwsResources()) {
    const resourceId = getResourceId(awsResource);

    let name = `import-${resourceId}`;

    if ('Name' in awsResource) {
      // Assuming that a Name attribute must be unique, e.g. for an S3 bucket.
      name = awsResource['Name'];
    } else if ('Tags' in awsResource) {
      for (const tag of awsResource['Tags']) {
        if (tag['Key'] === 'Name') {
          // Name tag values have no unique requirement, and thus need
          // the ID appended to ensure uniqueness.
          name = `${tag['Value']}-${resourceId}`;
          break;
        }
      }
    }

    pulumiResources.push({
      type: pulumiTypeIdentifier,
      name: name,
      id: resourceId,
    });
  }

  return pulumiResources;
}

function importEc2Resources(
  resourceTypeSnakeCase: string,
  ec2Client: AWS.EC2,
): Resource[] {
  const resourceTypePascalCase = stringcase.pascalcase(resourceTypeSnakeCase);
  const resourceTypeCamelCase = stringcase.camelcase(resourceTypeSnakeCase);

  const getAwsResources = () => ec2Client[`describe${resourceTypePascalCase}s`]()[`${resourceTypePascalCase}s`];
  const getResourceId = (resource: any) => resource[`${resourceTypePascalCase}Id`];
  const pulumiTypeIdentifier = `aws:ec2/${resourceTypeCamelCase}:${resourceTypePascalCase}`;

  return generateImportResources(getAwsResources, getResourceId, pulumiTypeIdentifier);
}

function importRouteTableAssociations(ec2Client: AWS.EC2): Resource[] {
  const pulumiResources: Resource[] = [];

  const routeTables = ec2Client.describeRouteTables()['RouteTables'];

  for (const routeTable of routeTables) {
    for (const association of routeTable['Associations']) {
      if (!('SubnetId' in association)) {
        continue;
      }
      pulumiResources.push({
        type: 'aws:ec2/routeTableAssociation:RouteTableAssociation',
        name: `import-${association['RouteTableAssociationId']}`,
        id: `${association['SubnetId']}/${routeTable['RouteTableId']}`,
      });
    }
  }

  return pulumiResources;
}

function getEc2Instances(): any[] {
  const reservations = ec2Client.describeInstances()['Reservations'];
  return reservations[0]['Instances'] || [];
}

const pulumiImport = {
  resources: [],
};

const resourceTypes = [
  'vpc',
  'subnet',
  'route_table',
  'nat_gateway',
  'internet_gateway',
];

for (const resourceType of resourceTypes) {
  pulumiImport['resources'] = pulumiImport['resources'].concat(importEc2Resources(resourceType, ec2Client));
}

// These don't follow the pattern:
pulumiImport['resources'] = pulumiImport['resources'].concat(importRouteTableAssociations(ec2Client));

pulumiImport['resources'] = pulumiImport['resources'].concat(generateImportResources(
