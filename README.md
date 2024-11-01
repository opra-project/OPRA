<p align='center'><img src="images/logo.png" alt="My Logo" width="512" /></p>

## About

OPRA is an open, community-maintained directory of product information and EQ compensation 
curves that optimize a wide range of headphone models. 

This open dataset is intended to be a resource that anyone can use, whether for
personal projects, open-source applications, or commercial applications, with
minimal restrictions.

The OPRA project started at Roon Labs, the makers of the [Roon](https://roon.app) music 
management software, and Roon continues to contribute by maintaining the repository, 
creating vendor and product artwork, and assisting with data ingestion and cleanup.

## How do I contribute to the database?

Follow our file and directory structure, and submit a PR with your changes.

See [CONTRIBUTING.md](docs/CONTRIBUTING.md) for more detailed documentation.

## How do I consume this database?

The dataset is automatically generated after every commit to the repository.

See [CONSUMING.md](docs/CONSUMING.md) for information about the dataset formats, and 

## FAQ

### How is this repository licensed?

The code in this repository is released under the [MIT license](https://opensource.org/license/mit).

Manufacturer, product, and EQ data is licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/legalcode.en), in a similar
manner to Wikipedia. This license allows both commercial and non-commercial use and
ensures that derivative works remain available to the community.

Attribution is required at two levels. If you are presenting a browser for the 
OPRA database, please include the logo, as well as a brief description of what the 
project is all about and a link to the repository. For example:

<img src="images/opra_attribution_sample.png" alt="OPRA attribution sample" width="512" />

When attributing presets, it is important to credit the preset creator as well 
as the database itself. For example:

<img src="images/preset_attribution_sample.png" alt="Preset attribution sample" width="512" />

### Why is Roon Labs doing this?

A lot of Roon users are also headphone enthusiasts, but getting headphone EQs
into playback software is a manual process that involves combing internet forums 
and manually entering data into playback software. This is intimidating for people
new to the hobby, and inefficient for the rest of us.

EQ curves are described in varying formats and terms, sometimes delivered via pdf,
or simply in forum messages. Terminology is inconsistent, and information appears
in varying levels of readiness for use. There is no one-size-fits-all solution 
for importing an EQ specification into a piece of software.

We want to make this process easier for headphone enthusiasts regardless of what 
software they choose to use. We also want to help new members of the community, who 
may not be as active on internet forums, to find these resources in their software of 
choice.

We felt that an open approach would be more beneficial for everyone involved. We are 
trying to solve an access and convenience issue, not just for Roon, but for the 
headphones community at large. We are in a good position to commit some resources to 
making this a success, so we decided to proceed with an open approach

### How is Roon Labs involved in this project?

Roon has set up the repository, defined the git-based database format and built the
documentation and tooling that surround this dataset. We will also be reviewing approving
PRs as the community builds out the repository, and as leaders emerge in the community,
we will share this responsibility with others to ensure that this project is resillient 
to future change.

Going forward, we will work to keep the data set clean and consistent so that when it
is utilized within a product, the experience is great. We will use our graphic design team 
to maintain high quality product and manufacturer artwork, as we recognize that many people 
interested in contributing data may not be in a position to produce high quality graphics assets.

### Where is the data coming from?

This repository is intended to aggregate the major creators of EQ curves from
the headphones communities. We have kicked things off by ingesting and cleaning data 
from [the AutoEQ project](https://github.com/jaakkopasanen/AutoEq), as it is already 
released under a sufficiently permissive license. 

We hope that over time other major creators of EQ compensation curves will choose to be 
a part of this, and we look forward to learning where the community wants this project
to go next.

### Who can use this data?

It is our hope that this dataset will be used by everyone--hobbyists, open source
projects, and commercial products, and that it will become the canonical place where 
headphone models and EQ adjustments are cataloged and distributed.

### Will community members be able to approve PRs?

As strong contributors and leaders emerge in the community, we will distribute merge
permissions accordingly.
